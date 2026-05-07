# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2026-05-07]

### Added
- Dedicated split-pane Notes page at `#/facility-portal/notes` with URL-driven group, selection, search, and archived state, enabling shareable deep links into a specific note or filtered view.
- Modal "New note" Composer launched from the Notes page toolbar.

### Changed
- Extracted `Composer`, `ReplyBox`, `ReplyItem`, `NoteCardSkeleton`, shared types, and group constants out of the embedded Operations notes feed into `client/src/components/notes/` so the embedded feed and the new Notes page share one source of truth.
- Operations tab notes feed now exposes a "View all notes →" link that deep-links into the new page.

### Fixed
- `optimisticAcked` state no longer leaks across notes when switching selection.
- `useNotesUrlState.patch()` now correctly accumulates two synchronous calls within the same React tick.
