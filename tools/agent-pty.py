#!/usr/bin/env python3
"""POSIX controlling PTY. JSON-lines control, byte-exact base64 output.

The host executes argv without shell interpolation. This is a trusted native
process, NOT a sandbox. Resize acknowledgements are ordered with PTY output.
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
            for name in ('SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGPIPE', 'SIGTSTP', 'SIGTTIN', 'SIGTTOU'):
                signal.signal(getattr(signal, name), signal.SIG_DFL)
            os.execvpe(config['argv'][0], config['argv'], os.environ)
        except BaseException as error:
            os.write(2, (str(error) + '\r\n').encode('utf-8', errors='replace'))
            os._exit(127)
    os.close(slave)
    os.set_blocking(master, False)
    os.set_blocking(0, False)
    incoming, outgoing = bytearray(), bytearray()
    deadline = None
    control_eof = pty_eof = False
    exit_status = None
    shutdown_groups = {pid}

    def foreground():
        try:
            group = os.tcgetpgrp(master)
            return group if group > 0 else pid
        except OSError:
            return pid

    def send_signal(number, closing=False):
        # Ctrl-C/agent interrupts target the foreground job, not its interactive
        # shell as well. Closing must also terminate the session's shell group.
        groups = {foreground()}
        if closing:
            shutdown_groups.update(groups)
            groups = shutdown_groups
        for group in groups:
            if group > 0 and group != os.getpgrp():
                try:
                    os.killpg(group, number)
                except ProcessLookupError:
                    pass

    def stop(_signum=None, _frame=None):
        nonlocal deadline
        send_signal(signal.SIGHUP, closing=True)
        if deadline is None:
            deadline = time.monotonic() + 0.75

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)
    emit({'type': 'ready', 'pid': pid})
    try:
        while True:
            if deadline is not None and time.monotonic() >= deadline:
                send_signal(signal.SIGKILL, closing=True)
                deadline = time.monotonic() + 3600
            inputs = ([] if control_eof else [0]) + ([] if pty_eof else [master])
            readable, writable, _ = select.select(inputs, [master] if outgoing and not pty_eof else [], [], 0.05)
            if master in readable:
                try:
                    chunk = os.read(master, 65536)
                    if chunk:
                        emit({'type': 'data', 'data': base64.b64encode(chunk).decode('ascii')})
                    else:
                        pty_eof = True
                except OSError as error:
                    if error.errno == errno.EIO:
                        pty_eof = True
                    elif error.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                        raise
            if 0 in readable:
                chunk = os.read(0, 65536)
                if not chunk:
                    stop()
                    control_eof = True
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
                            cols, rows = message['cols'], message['rows']
                            if type(cols) is not int or type(rows) is not int or not 2 <= cols <= 500 or not 2 <= rows <= 200:
                                raise ValueError('Invalid terminal dimensions')
                            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
                            emit({'type': 'resize', 'cols': cols, 'rows': rows, 'requestId': message.get('requestId')})
                        elif kind == 'signal':
                            name = message['signal']
                            if name not in ('SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGTSTP', 'SIGCONT'):
                                raise ValueError('Unsupported signal')
                            send_signal(getattr(signal, name))
                        elif kind == 'close':
                            stop()
                        else:
                            raise ValueError('Unknown PTY control message')
            if master in writable and outgoing:
                try:
                    count = os.write(master, outgoing)
                    del outgoing[:count]
                except OSError as error:
                    if error.errno == errno.EIO:
                        outgoing.clear()
                    elif error.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                        raise
            if exit_status is None:
                child, status = os.waitpid(pid, os.WNOHANG)
                if child:
                    exit_status = os.waitstatus_to_exitcode(status)
                    # Descendants holding the slave open cannot hold the helper
                    # alive indefinitely after the controlling shell has exited.
                    stop()
            if pty_eof and exit_status is None:
                stop()
            if exit_status is not None and pty_eof:
                break
    finally:
        stop()
        try:
            os.close(master)
        except OSError:
            pass
        if exit_status is None:
            send_signal(signal.SIGKILL, closing=True)
            _, status = os.waitpid(pid, 0)
            exit_status = os.waitstatus_to_exitcode(status)
    emit({'type': 'exit', 'code': exit_status})


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        emit({'type': 'error', 'message': str(error)})
        sys.exit(1)
