# jupyterlab_workspace_manager_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_workspace_manager_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_workspace_manager_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_workspace_manager_extension.svg)](https://www.npmjs.com/package/jupyterlab_workspace_manager_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-workspace-manager-extension.svg)](https://pypi.org/project/jupyterlab-workspace-manager-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-workspace-manager-extension)](https://pepy.tech/project/jupyterlab-workspace-manager-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

The Running Terminals and Kernels panel, organised by workspace. Each JupyterLab workspace becomes one section of an accordion: its colour, its purpose, how long ago it was used, and the tabs, terminals and kernels it holds.

> [!NOTE]
> The features below are the planned scope. The design proposal in `docs/design/` waits for approval; the code is still the template placeholder.

## Features

- **Workspaces as accordion sections** - one section per workspace, and opening one section closes the open one
- **Workspace colour** - a colour strip on the edge of each section, assigned in rotation from a palette like the tab colours of `jupyterlab_colourful_tab_extension`
- **Purpose and age** - an optional purpose text, and the time since the workspace was last used
- **Counts in the header** - the number of terminals and kernels of the workspace
- **Header actions** - open the workspace with its tabs, close all tabs of the workspace
- **Tabs, terminals, kernels** - inside a section, the tabs of the workspace, then its terminals and kernels
- **Terminal activity and process** - each terminal shows when it was last active and the name of the process running in it

## Requirements

- JupyterLab >= 4.6

## Install

To install the extension, execute:

```bash
pip install jupyterlab_workspace_manager_extension
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyterlab_workspace_manager_extension
```
