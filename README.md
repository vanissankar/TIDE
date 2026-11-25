# TIDE · CSE Workload Monitor

Responsive workload app built with React, Vite, Tailwind CSS, Node and Express. Locally, Vite serves the frontend on port 5173 and Express serves the API on port 4000. Vercel serves the Vite build and Express API from this project.

## Run locally

```bash
npm.cmd install
npm.cmd run dev
```

With no spreadsheet credentials, local demo accounts are `hod@cse.edu` / `hod123` and `ananya.rao@cse.edu` / `faculty123`. When a Google service account is configured, demo logins are disabled; set real login values in `.env` first.

## Google Sheets setup

The Google API is used by the Express backend only. The service account must have the Sheets API enabled and Editor access to the spreadsheet. Keep the JSON key file in this project folder and use `GOOGLE_SERVICE_ACCOUNT_FILE` locally. The file pattern is ignored by Git. For Vercel, set `GOOGLE_SERVICE_ACCOUNT_JSON` to the JSON content as a server environment variable; never put credentials in frontend variables.

This app maps the workbook's existing tabs: `Faculty Directory`, `Responsibilities`, `Assigned Tasks`, and `Task Updates`. It reads and writes their existing columns, preserves other columns and history, and does not create tabs or clear whole sheets. Faculty status changes update the task's `status` cell and append a row to `Task Updates`. HOD changes are saved to those same existing tabs. Spreadsheet dates are normalized for the app.

## Deadline email reminders

The scheduled reminder job checks tasks daily at 9:00 AM India time. It emails each assigned faculty member once at the halfway date between the task's assigned/start/created date and its deadline, then again on the deadline date. Completed tasks are skipped. Successful and failed delivery attempts are recorded in the existing `Reminder Log`; repeated requests are deduplicated.

Email delivery uses the Resend email API. Set `RESEND_API_KEY` and `REMINDER_FROM_EMAIL` on the backend, using a sender address/domain verified with Resend. Set `CRON_SECRET` in Vercel so the scheduled endpoint is protected. Vercel Cron runs only on production deployments and interprets its schedule in UTC; `30 3 * * *` is 9:00 AM in India. The endpoint is `/api/cron/reminders`.

The current spreadsheet has no task dates and only one faculty email address, so reminders will not reach the whole staff until HOD fills the `Assigned Tasks` date fields and `Faculty Directory` email cells. For existing tasks, set `deadline` and either `assigned_date` or `start_date`; if both are blank, the job uses `created_at` as the halfway baseline. Newly created tasks receive an assigned date automatically.

Copy `.env.example` to `.env`. For local Google Sheets access, set the service account file path and spreadsheet ID. Before enabling login, set a long random `JWT_SECRET`, `HOD_EMAIL`, `HOD_PASSWORD`, and a shared `FACULTY_PASSWORD` if faculty rows do not already contain supported `scrypt$salt$hash` password values. Never paste passwords or private keys into chat or source files. The current sheet's faculty password-hash column must be provisioned before faculty can sign in unless the shared faculty password is configured.

The app requires the existing four tabs above. If one is missing, startup reports the missing tab and does not create or initialize any sheet.

## Vercel

Import this folder as the Vercel project root. Configure `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `JWT_SECRET`, `HOD_EMAIL`, `HOD_PASSWORD`, `FACULTY_PASSWORD`, `CRON_SECRET`, `RESEND_API_KEY`, and `REMINDER_FROM_EMAIL` as server-side Project Environment Variables, then redeploy. Use a unique HOD password and a random JWT secret. Never use `VITE_` prefixes for secrets.
