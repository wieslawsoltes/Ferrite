#!/usr/bin/env python3
"""Actual system ncurses fixture, driven through keyboard/mouse/resize APIs."""
import curses
import locale
import os
import sys
locale.setlocale(locale.LC_ALL, '')


def app(stdscr):
    curses.curs_set(1)
    curses.noecho()
    curses.cbreak()
    stdscr.keypad(True)
    stdscr.timeout(100)
    curses.mouseinterval(0)
    curses.mousemask(curses.ALL_MOUSE_EVENTS | curses.REPORT_MOUSE_POSITION)
    if curses.has_colors():
        curses.start_color()
        curses.init_pair(1, curses.COLOR_CYAN, curses.COLOR_BLACK)
    selected, typed, status = 1, '', 'Ready'
    while True:
        rows, cols = stdscr.getmaxyx()
        stdscr.erase()
        if rows >= 12 and cols >= 40:
            stdscr.attron(curses.color_pair(1) | curses.A_BOLD)
            stdscr.box()
            stdscr.addstr(1, 2, 'Ferrite ncurses interoperability')
            stdscr.attroff(curses.color_pair(1) | curses.A_BOLD)
            for y, text in enumerate([
                'Size: %dx%d' % (cols, rows), 'Selected: %d' % selected,
                'Event: ' + status, 'Input: ' + typed, 'Unicode: 界e\u0301',
                'Arrows / F1 / mouse / q to quit'
            ], 3):
                stdscr.addnstr(y, 2, text, cols - 4)
            stdscr.move(9, 2)
        stdscr.refresh()
        try:
            key = stdscr.get_wch()
        except curses.error:
            continue
        if key == 'q':
            break
        if key == curses.KEY_DOWN:
            selected += 1
            status = 'KEY_DOWN'
        elif key == curses.KEY_UP:
            selected = max(1, selected - 1)
            status = 'KEY_UP'
        elif key == curses.KEY_F1:
            status = 'HELP'
        elif key == curses.KEY_RESIZE:
            status = 'RESIZED'
        elif key == curses.KEY_MOUSE:
            _, x, y, _, _ = curses.getmouse()
            status = 'MOUSE %d,%d' % (x + 1, y + 1)
        elif isinstance(key, str) and key.isprintable():
            typed = (typed + key)[-20:]
            status = 'TEXT'


sys.stdout.write('NORMAL BUFFER\r\n\x1b]2;Ferrite ncurses fixture\x07')
sys.stdout.flush()
curses.wrapper(app)
print('CURSES_EXIT_OK')
