"""User-level access to workbench chrome for feature acceptance suites."""
from playwright.sync_api import expect


def show_workspace_actions(page):
    page.wait_for_function('!!window.ferrite')
    if page.locator('#workspace-actions').is_hidden():
        page.get_by_role('button', name='Main Menu', exact=True).click()
        page.get_by_role('menuitem', name='Show Workspace Actions', exact=True).click()


def resize_tool_window(page, side, pixels):
    """Resize the real workbench through its public keyboard separator control."""
    directions = {'left': 'ArrowRight', 'right': 'ArrowLeft', 'bottom': 'ArrowUp'}
    minimum = 120 if side == 'bottom' else 180
    if side not in directions or pixels < minimum or pixels > 1600 or (pixels - minimum) % 20:
        raise ValueError('Choose a tool side and a size in 20px steps above its minimum')
    separator = page.get_by_role('separator', name=f'Resize {side} tool windows', exact=True)
    expect(separator).to_be_visible()
    separator.focus()
    separator.press('Home')
    for _ in range((pixels - minimum) // 20):
        separator.press(directions[side])
    expect(separator).to_have_attribute('aria-valuenow', str(pixels))
