# Workspace panel for JupyterLab

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_workspace_manager_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_workspace_manager_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_workspace_manager_extension.svg)](https://www.npmjs.com/package/jupyterlab_workspace_manager_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-workspace-manager-extension.svg)](https://pypi.org/project/jupyterlab-workspace-manager-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-workspace-manager-extension)](https://pepy.tech/project/jupyterlab-workspace-manager-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

This extension replaces the built-in Running Terminals and Kernels sidebar with a panel organised by workspace: one section per workspace, one section open at a time.

![The workspace panel](https://raw.githubusercontent.com/stellarshenson/jupyterlab_workspace_manager_extension/main/docs/images/panel.png)

_Fig 1 - The panel with one workspace open, and its Other sessions and In no workspace sections closed_

## Features

- **Workspace section** - the colour strip, the optional purpose, the age and the number of tabs, terminals and kernels the workspace holds
- **Triangle** - opens or closes a section
- **Header** - a click on the name of another workspace switches this window to it, and a click on this window's workspace closes it
- **Menu** - open, open in a new browser tab, close all tabs, set description, colour, hide, delete
- **Hide** - a hidden workspace leaves the panel, and the number of hidden workspaces sits under the last section
- **In no workspace** - the terminals, kernels and language servers that belong to no workspace, with shut down for one item and for all of them
- **Other sessions** - the open tabs, kernels, language servers and recently closed documents of the lab
- **Filter** - shows the workspaces whose name, purpose or rows match, and opens each of them
- **New workspace** - the + button creates a workspace and asks for its name and an optional description

## Requirements

The extension needs JupyterLab 4.6 or later.

## Install

Install the package from PyPI.

```bash
pip install jupyterlab-workspace-manager-extension
```

## Uninstall

Remove the package.

```bash
pip uninstall jupyterlab-workspace-manager-extension
```
