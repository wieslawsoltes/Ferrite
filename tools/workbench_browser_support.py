"""User-level access to optional workbench chrome for existing feature suites."""
def show_workspace_actions(page):
    page.wait_for_function('!!window.ferrite')
    if page.locator('#workspace-actions').is_hidden():
        page.get_by_role('button', name='Main Menu', exact=True).click()
        page.get_by_role('menuitem', name='Show Workspace Actions', exact=True).click()
