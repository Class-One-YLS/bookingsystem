# Class One Internal System Overview

This output keeps the active Class One operations modules focused on timetable, teacher, student, recovery, leave, public holiday, users, policy settings, activity logs, and the private Teacher View.

## Active Frontend Files

- `index.html`: main admin system.
- `teacher-timetable-view.html`: private read-only teacher timetable page.
- `shared/api.js`: shared API helpers.
- `shared/session.js`: shared session helpers.
- `ClassOneBookingCode.gs`: legacy Google Apps Script backend for timetable-oriented Google Sheet sync.

## Active Modules

- Weekly Timetable
- Teacher Overview
- Class Management
- Students
- Teachers
- Teacher Student Records
- Public Holiday
- Policy Settings
- Users
- Activity Log
- Sync Settings
- Teacher View

## Retired Module Data

The retired sales pipeline, tutor applicant pipeline, and management dashboard modules are no longer part of the active frontend. Legacy data collections related to those retired modules are intentionally not deleted from production data during this cleanup. They are preserved only for data safety and compatibility with existing saved state.

## Notes

- Neon remains the main database.
- Existing booking, recurring class, class outcome, public holiday, teacher leave, replacement, student, teacher, user, policy, activity log, and Teacher View logic should remain unchanged by this cleanup.
- This cleanup reduces the active frontend bundle and removes deleted module navigation, pages, renderers, handlers, and standalone CRM workspace files.
