# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [0.8.16] - 2026-10-25

### Added

- The workspace panel replaces the built-in Running Terminals and Kernels sidebar: one accordion section per workspace, with its colour strip, purpose, age and counts
- A card menu with open, open in a new browser tab, close all tabs, set description, colour, hide and delete
- Hiding a workspace, with the number of hidden workspaces under the last card
- In no workspace lists the lab's language servers beside its terminals and kernels, with shut down for one item and for all of them
- Other sessions lists the lab's open tabs, kernels, language servers and recently closed documents, with their actions
- A filter over workspace names, purposes and rows, which opens every card with a match
- A + button that creates a workspace and asks for its name and an optional description
- An action on a workspace another window shows is refused, so two windows never write one at once

### Changed

- The triangle opens or closes a card; a click on the header of another workspace's card switches this window to it, and a click on this window's card closes it
- The header shows how much a card holds, an open card ends with its last row, and Open and Close all tabs moved into its menu
- At the 250 px sidebar width the title and the labels shorten in a fixed order, and the hover icons take the age's place so a long name keeps its width
- A kernel row is named by its kernelspec display name, and two views of one document make one row

### Fixed

- Shut down all in In no workspace counted and shut only the terminals and kernels, so a language-servers-only section asked to shut down nothing
- The triangle's target was 16 px wide beside a header click that navigates; it now uses the panel's 22 x 22 icon button
- The Galata suite's waits now tolerate a host under heavy load, with one 60 s constant for the load-tolerant waits

<!-- <END NEW CHANGELOG ENTRY> -->
