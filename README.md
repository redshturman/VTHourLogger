# VisualTimeSetter

Independent local app for preparing historical **missing punch** requests in
Cegid Visualtime Portal.

The interface, calendar, instructions, and app-generated messages are in English.
Dates use **dd/mm/yyyy** and times use **24-hour HH:mm**, regardless of browser
locale. The app does not change the Visualtime portal's language. Original portal
labels and error details are retained when needed for navigation or diagnosis.

**Integration status:** the adapter uses the user's authenticated form diagnostic
and the portal's public JavaScript. The user has confirmed real submissions, but
also encountered an automated `-50` rejection for a request that could then be
saved manually. Subsequent fixes isolate each form with a full document reload
and read the validated request's network response rather than relying solely on
the portal callback. Automated checks use intercepted fixtures, not real writes.
They do not prove compatibility with the live account.

## Start on Windows

Requires Node.js 20 or later and Microsoft Edge.

Double-click `start.cmd`. It installs dependencies if missing, starts the server,
and opens `http://127.0.0.1:4317`. Keep the console open while using the app.
Close it with Ctrl+C. Alternatively:

```powershell
npm install
npm start
```

The server listens only on `127.0.0.1`, not on the local network. Run only one
copy from this folder. Do not share the port through a tunnel.

After server-side code changes, stop the old console with Ctrl+C, run
`start.cmd` again, and reload the interface. Reconnect using the new Edge
window: the previous process's browser session is not transferred.

## Prepare a date range

1. Enter inclusive start and end dates in **dd/mm/yyyy**, and the hours actually
   worked in **24-hour HH:mm** (for example, 08:00 and 18:00). Use Calendar to
   choose a date and Time to select the hour and minute, or type the values.
2. Generate the preview. Weekdays are checked by default. Saturdays and Sundays
   are displayed unchecked, disabled, and without times; they are never submitted.
   Select all weekdays affects weekdays only.
3. Manually uncheck public holidays, leave, and any other days you did not work.

The default **2 punches per day** creates one clock-in and one clock-out request.
Choose **4 punches per day (lunch break)** to also configure **Lunch clock-out
time** and **Lunch return time**. Each selected day then submits, in order:
clock in, lunch clock out, lunch return, final clock out. All four times are
required and must be strictly increasing within the same day. Switching back to
2 punches ignores the lunch times. The preview, counts, and confirmation reflect
the selected mode; changing it requires generating the preview again.

All requests use the
Attendance type (Presencia in the Spanish portal). Reason and Comments are left
unchanged. The same schedule applies to all selected days. Only same-day shifts
are supported: clock-out must be later than clock-in. The app does not consult
holiday calendars or look up existing punches in advance.

Requests require supervisor approval: **submitted does not mean approved**.
The app never uses the live clock-in or quick punch button.

## Connect and fill in working hours

1. Click **Open portal in Edge**. A separate window opens.
2. Sign in yourself, including SSO/MFA if required. Do not share your password.
   The app does not fill in sign-in fields.
3. Open **Request → Missing punch**, shown as **Solicitar → Fichaje no realizado**
   in the Spanish portal. Do not click its Save (disk) button.
4. Return to the app and click **Connect form**. This read-only check verifies
   the personal account, new-request form, DevExtreme controls, Attendance type,
   and empty Reason/Comments. The result appears next to the button. Attendance
   is checked using widget ID `1` (numeric or string), not the first input,
   because DevExtreme may insert a hidden input.
5. Review the date range and selection, then click **Test fill without saving**.
   The first selected clock-in is filled in Edge. Check its date, time, and
   direction. Do not click the portal's Save button.
6. Return to VisualTimeSetter and click **Confirm and submit** only if the data
   is correct and you want to submit the batch. All selected punches are
   attempted again, even if the local journal records them as submitted or
   existing. Do not interact with Edge during submission. Progress and results
   are shown for each request.

Opening the browser or signing in never starts submission automatically.

Before each fill, the entire document is reloaded to avoid reusing cached portal
views and service instances. This includes both punches on the same day and the
test fill. Since Visualtime navigates to Home on startup, the adapter first waits
for authenticated startup, then navigates to the new-request form. It rechecks
the account and waits for all controls, including Direction, to be visible,
initialized, and editable. A route change alone is not enough. If sign-in is
required again or the account changes, Save is not clicked.

The browser time zone is Europe/Madrid. Future times and nonexistent local times
caused by daylight-saving transitions are rejected.

## Diagnostics and safeguards

**Inspect form (read-only)** diagnoses portal changes without filling fields or
saving requests. It extracts metadata for visible controls, labels, and buttons,
not input values, comments, passwords, or cookies. Portal labels remain in their
original language and may contain identifying text: review the diagnostic
before sharing. It is saved only when downloaded.

Edge uses a temporary session separate from your regular profile. Cookies,
passwords, and `storageState` are not exported. Authentication is lost when the
process closes. Employee impersonation is not supported. Each batch is bound
to a fingerprint of the account, company, and service address.

Only the `value` options of `dxDateBox: beginDate` and
`dxSelectBox: cmbRequestValue1` are changed, and all fields are checked afterward.
Nonempty Reason/Comments are never cleared: submission is blocked instead.

Saving uses the actual form button, not a direct API invocation. The portal's
public code identifies `SaveRequestForbiddenPunch` and success code `d.Status=0`.
The adapter resolves the relative service URL against the current portal URL.
It validates the outgoing multipart date, time, direction, reason, comments,
Attendance type, and `acceptWarning=false` before releasing the request.
Repeated or unexpected invocations are blocked.

The acknowledgement is read from the response to that exact validated request
object, allowing a query string without confusing unrelated responses. The
`onSuccessCall` callback is also observed and its status is checked if received.
A missing callback does not prevent recognizing the server response or closing
a duplicate warning. Observers and network guards are removed afterward.

Success requires a valid acknowledgement and leaving the form; HTTP 200 or the
form disappearing alone is insufficient. If no official request identifier is
returned, the journal stores an acknowledgement description, not an invented ID.
Warnings are never accepted automatically. `PunchWithoutRequest=true` is reported
as a direct punch and stops the batch for review.

## Duplicates, retries, and the journal

- Explicit confirmation, an identified account, and a successful test fill are
  required before submitting. An open browser alone is insufficient.
- Before each write, an uncertain intent is persisted atomically in
  `data\journal.json`. If that fails, the portal write is not attempted.
- The journal is history, not proof that a punch still exists. Every newly
  confirmed batch attempts the entire selection, including previously submitted,
  existing, rejected, and uncertain items, even after restarting. This allows
  recreating punches deleted in the portal without deleting the journal.
- `-50` means the portal rejected a repeated request. It is recorded as rejected
  with the original visible warning, not as proof of a visible existing request.
  `-51` is recorded as existing according to the portal's current response.
  Neither is counted as a newly submitted or approved request.
- The adapter waits for the duplicate dialog's Close button (Cerrar in the
  Spanish portal), closes only that warning, and continues. It does not accept
  warnings or retry the item within the same batch.
- Each item is attempted once per batch. Failures are recorded as rejected,
  uncertain, or not attempted, and the next item is attempted. A newly confirmed
  batch retries all selected items regardless of previous status.
- Pending portal requests are allowed to finish before preparing the next item.
  Writes are not overlapped. Session/control failures are reported explicitly.
  Journal persistence failures stop the batch.

For a stopped batch, keep the journal, generate the intended range again, review
the portal, reconnect, test fill, and explicitly confirm only the intended
selection. An uncertain attempt may already have been saved; check the portal
before confirming another attempt. The confirmation warns about this risk.

The journal contains attendance dates, times, and request references, not
credentials. Keep it private. Existing history is not rewritten when the
interface language changes. Internal direction/type values and journal keys
remain compatible with earlier versions; only their displayed labels change.

## Local checks without real submissions

```powershell
npm test
npm run test:ui
```

Node and headless Edge checks cover inclusive date ranges, two-month periods,
weekday selection, disabled weekends, leap years, daylight-saving transitions,
English labels and errors, dd/mm/yyyy dates, 24-hour pickers, mobile layout,
confirmation/cancellation, persistence, duplicate handling, continuation after
failure, account changes, and outgoing data tampering.

All fixture requests are intercepted and never reach the real portal.
`test-results\preview.png` contains a test preview screenshot.
These checks do not create real requests or establish live-portal compatibility.
