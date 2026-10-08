#!/usr/bin/env python3
"""POSIX PTY host. Private JSON-lines control channel; terminal bytes are base64.

No shell interpolation: argv/cwd arrive as a JSON argument. The hosted shell or
CLI owns its normal job control and authentication. This is not a sandbox.
"""
import base64
import errno
import fcntl
import json
import os
import select
import signal
import struct
import sys
import termios
import time


def emit(message):
    sys.stdout.write(json.dumps(message, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def main():
    config = json.loads(sys.argv[1])
    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', config['rows'], config['cols'], 0, 0))
    pid = os.fork()
    if pid == 0:
        try:
            os.close(master)
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            for fd in (0, 1, 2):
                os.dup2(slave, fd)
            if slave > 2:
                os.close(slave)
            os.chdir(config['cwd'])
            for name in ('SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGPIPE'):
                signal.signal(getattr(signal, name), signal.SIG_DFL)
            os.execvpe(config['argv'][0], config['argv'], os.environ)
        except BaseException as error:
            os.write(2, (str(error) + '\r\n').encode('utf-8', errors='replace'))
            os._exit(127)
    os.close(slave)
    os.set_blocking(master, False)
    os.set_blocking(0, False)
    incoming = bytearray()
    outgoing = bytearray()
    deadline = None
    eof = False
    exit_status = None

    def send_signal(number):
        groups = {pid}
        try:
            groups.add(os.tcgetpgrp(master))
        except OSError:
            pass
        for group in groups:
            if group > 0 and group != os.getpgrp():
                try:
                    os.killpg(group, number)
                except ProcessLookupError:
                    pass

    def stop(_signum=None, _frame=None):
        nonlocal deadline
        send_signal(signal.SIGHUP)
        if deadline is None:
            deadline = time.monotonic() + 0.75

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)
    emit({'type': 'ready', 'pid': pid})
    try:
        while True:
            if deadline is not None and time.monotonic() >= deadline:
                send_signal(signal.SIGKILL)
                deadline = time.monotonic() + 3600
            readable, writable, _ = select.select(([0] if not eof else []) + ([master] if not eof or exit_status is None else []), [master] if outgoing else [], [], 0.05)
            if master in readable:
                try:
                    chunk = os.read(master, 65536)
                    if chunk:
                        emit({'type': 'data', 'data': base64.b64encode(chunk).decode('ascii')})
                    else:
                        eof = True
                except OSError as error:
                    if error.errno == errno.EIO:
                        eof = True
                    elif error.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                        raise
            if 0 in readable:
                chunk = os.read(0, 65536)
                if not chunk:
                    stop()
                    eof = True
                else:
                    incoming.extend(chunk)
                    if len(incoming) > 1024 * 1024:
                        raise ValueError('PTY control buffer exceeded 1 MiB')
                    while b'\n' in incoming:
                        line, _, rest = incoming.partition(b'\n')
                        incoming = bytearray(rest)
                        message = json.loads(line)
                        kind = message.get('type')
                        if kind == 'input':
                            outgoing.extend(base64.b64decode(message['data'], validate=True))
                            if len(outgoing) > 1024 * 1024:
                                raise ValueError('PTY input backpressure exceeded 1 MiB')
                        elif kind == 'resize':
                            cols, rows = int(message['cols']), int(message['rows'])
                            if not 2 <= cols <= 500 or not 2 <= rows <= 200:
                                raise ValueError('Invalid terminal dimensions')
                            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
                        elif kind == 'signal':
                            number = {'SIGINT': signal.SIGINT, 'SIGTERM': signal.SIGTERM, 'SIGHUP': signal.SIGHUP}.get(message['signal'])
                            if number is None:
                                raise ValueError('Unsupported signal')
                            send_signal(number)
                        elif kind == 'close':
                            stop()
                        else:
                            raise ValueError('Unknown PTY control message')
            if master in writable and outgoing:
                try:
                    count = os.write(master, outgoing)
                    del outgoing[:count]
                except OSError as error:
                    if error.errno not in (errno.EAGAIN, errno.EWOULDBLOCK, errno.EIO):
                        raise
            if exit_status is None:
                child, status = os.waitpid(pid, os.WNOHANG)
                if child:
                    exit_status = os.waitstatus_to_exitcode(status)
            if exit_status is not None and eof:
                break
    finally:
        stop()
        try:
            os.close(master)
        except OSError:
            pass
        if exit_status is None:
            send_signal(signal.SIGKILL)
            _, status = os.waitpid(pid, 0)
            exit_status = os.waitstatus_to_exitcode(status)
    emit({'type': 'exit', 'code': exit_status})


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        emit({'type': 'error', 'message': str(error)})
        sys.exit(1)
