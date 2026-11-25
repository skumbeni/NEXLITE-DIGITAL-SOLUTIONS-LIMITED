// ── MDM Service Worker — offline-first ──────────────────────────────────────
// Registered from same origin (not blob URL) so Android Chrome can
// intercept navigation requests and serve the shell when offline.
//
// Strategy:
//   navigate requests  → network-first (always try latest; fall back to cache)
//   Google Fonts       → cache-first (stale-while-revalidate)
//   Firebase REST      → network-only (never cache auth/data requests)
//   everything else    → pass-through (network only)
//
// Update flow:
//   1. New SW installs → skipWaiting() fires immediately (always)
//   2. activate purges old caches → clients.claim() takes over all tabs
//   3. SW posts { type:'NEW_VERSION', version:CACHE } to every open tab
//   4. index.html listener: Median → clears webview cache + hard reload
//                           Browser → shows update toast
//
// Median note:
//   Median's webview caches the HTML shell independently of the SW cache.
//   To guarantee Median users always get the latest version:
//   - index.html stamps every URL with ?_mv=<VERSION> and forces a reload
//     if the stamp is missing or outdated (medianUpdateCheck IIFE).
//   - The SW strips _mv from cache keys so ?_mv=mdm-v22 and the bare URL
//     resolve to the same cached entry — no double-fetching.
//   - On activate the SW posts NEW_VERSION → index.html clears the webview
//     cache and navigates to the stamped URL.
//
// Current version: v0.3.149 (2026-11-25) — Till: Text size setting − A + (pos.html + sw.js; no new file, NO database RULES change)
//   - ADDED: Till settings > Text size, with − A + buttons. Five sizes (85, 100, 115, 130, 150 %); A shows the size and goes back to 100 %. Kept on that phone only
//     (localStorage mdm_pos_text) and applied before the page paints. Every font size in pos.html's stylesheet is now calc(Npx*var(--ts,1)); the − / × icon buttons keep their
//     size, a text field is never smaller than before (iPhone zooms into fields under 16 px), and the printed receipt always prints at its own size (@media print resets --ts).
//   - NOT CHANGED: index.html (the main app has its own look), what any button does, prices, stock, the cart, Charge, the shift rule.
//   - Ships on top of v0.3.148 (index.html, sales.js and shifts.js as before).
// Previous version: v0.3.148 (2026-11-25) — Till: item tiles no longer cut their text (pos.html + sw.js; no new file, NO database RULES change)
//   - FIXED: on the till's item grid a tile's wrapped lines spilled out of the tile (a two-line name, or the pack line such as BOX ×5 · CARTON ×100 · PACK ×1,000, ran over the bottom border).
//     The flex column is now on an inner span (.tile .ti) instead of on the <button>, so the row height counts every wrapped line.
//   - NOT CHANGED: what any tile or button does, prices, stock, the cart, Charge, the shift rule, index.html.
//   - Ships on top of v0.3.147 (index.html, sales.js and shifts.js as before).
// Previous version: v0.3.147 (2026-11-25) — Staff tab: accessibility, the leftovers of v0.3.146 (index.html + sw.js; no new file, NO database RULES change)
//   - FIXED (contrast, dark theme): blue and purple text (the Earnings By task fold, the related-record icon, the Career line, the Net to date column, the Edit buttons and the Leave note) was 4.0 to 4.05:1 on a card, and 3.4:1 in the blue Leave note. In the Staff tab they are now lighter in the dark theme (8.0 / 6.8:1). The light theme keeps its colours (6.7 / 8.6:1).
//   - FIXED (contrast, light theme): the Clock in button had dark text on a dark-green gradient (3.6:1 at the left end, 2.4:1 at the right); its text is white in the light theme (5.4 / 8.3:1). The role tag had a navy fill with grey text (1.4:1); it now has a light fill in the light theme (4.8:1).
//   - FIXED (a word beside the colour, no emoji): the sync chip at the top of the Staff tab still used the emoji form (the check mark, cloud, phone and warning signs, which a screen reader reads out as pictures). It uses the same line-icon form as Inventory, also when it refreshes itself every 30 seconds. A failing-sync chip is red from the tab's red (3.8:1 on white before).
//   - CHANGED (keyboard and touch): the edit and delete icon buttons and the search box show the green keyboard outline; the row menu button has a 44 px tap area on a wide screen too, without making rows taller.
//   - CHECKED, no change needed: staff rows, the Active shifts banner, the By task fold, the note and related-record icons are buttons; the More, views and row menu buttons have a label, aria-haspopup and aria-expanded, and their sheet closes on Escape, keeps focus inside and gives it back; the chevron on a phone row says whether it is open. Table rows that open on a tap (phone only) have that chevron button for the keyboard, as in Inventory.
//   - NOT CHANGED: the pop-ups (steps 17 to 27, including the profile's photo button, the Role history and Productivity folds), what any button does, the figures, the dashboard and Inventory (their Receive / Clock in style buttons have the same dark-text-on-green issue in the light theme; not touched here).
//   - Ships on top of v0.3.146 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.146 (2026-11-25) — Staff tab: accessibility (index.html + sw.js; no new file, NO database RULES change)
//   - CHECKED (step 16): the staff rows are already buttons (step 3); the More, views and row ⋯ buttons already have a label, aria-haspopup and aria-expanded, and the action sheet they open already closes on Escape, keeps focus inside and gives it back (the sheet's own code); the row chevrons, Select, ⋯ and the Export / period controls already had an outline and a 44 px tap area.
//   - CHANGED (step 16): the Active shifts banner is a real button (the Clock out button sits beside it, not inside it, which would be a button in a button). The By task fold in Earnings is a button that says whether it is open (aria-expanded), and the note and related-record icons in Work logs are buttons with labels. They all have a visible outline and a 44 px tap area that does not make rows taller.
//   - CHANGED (step 16, the rest): Clock in, Pay and the empty-state button now show the outline too; the tick boxes are 22 px; edit and delete buttons are 44 px on a touch screen; Clock out is 44 px.
//   - CHANGED (step 16, contrast): the whole tab uses the dashboard's contrast colours, like Inventory: red lightened in the dark theme; muted, amber, green and red darkened in the light theme. The two note boxes (Wage Disclaimer in Earnings, the entitlement note in Leave) were a fixed dark brown and navy; they are now a light tint of amber and blue, so they read in both themes.
//   - CHANGED (step 16, a word beside the colour): a leave balance of 3 days or less, or below zero, now has a Low or Overdrawn chip beside the number; before only the colour said so. Every other colour in the tab already has a word beside it (chips, column heads, "Unpaid balance", the role dot beside the role name).
//   - NOT CHANGED: the pop-ups (steps 17 to 27), what any button does, the figures.
//   - Ships on top of v0.3.145 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.145 (2026-11-25) — Staff tab: empty states, and role names as they are (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (step 15): an empty view now shows the dashboard's empty-state card, one sentence and one button, instead of a bare table row or a line of text. Work logs: "No work logged in this period." with Clock in (with a task filter on: "No work logged for <task> in this period." with Show all tasks; with no staff at all: "No staff added yet." with Add staff). Earnings, Payments, Contracts: "No staff added yet." with Add staff (a Manager or staff login sees "Ask an Admin to add them" and no button, as in the Staff view). Leave: "No active staff yet." with Add staff. With no staff, Payments no longer also shows an empty "Payment summary by role" table.
//   - CHANGED (step 15, wording): the Payments summary table showed each role as the role name plus "S" in capitals (Secretary became SECRETARYS); it now shows the role name as it is. The Staff view's headings already used the role name as it is (step 3).
//   - NOT CHANGED: the payroll run screens and printed pages still add "s" to a payroll group name (pop-ups, steps 25 to 27), and the Roles & rates "Admin access required" message.
//   - Ships on top of v0.3.144 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.144 (2026-11-25) — Staff tab: the dashboard's type sizes and radii, and named classes (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (step 14): the Staff tab reads the dashboard's five text sizes (caption 15 / body 17 / title 19 / heading 23 / figure 31) and two radii (card 12 / control 10), the same ones Inventory uses. The shared classes the tab uses (cards, titles, tiles, labels, headings, column heads, chips, tables, fields, buttons, empty rows) take their sizes from them. Sizes that were 13, 14 or 16 px move to 15 or 17, and 22 px to 23; the radii of 3, 8 and 10 are now the control radius, and the cards use the card radius.
//   - CHANGED (step 14): the repeated inline styles in Work logs, its subtotal rows, Earnings, Payments, Staff, Contracts, Leave and Roles & rates became .iv-* classes (the same names Inventory uses, plus a few new ones for the notes, tiles and rows), scoped to the tab (.stx), so no other screen changes. A style that holds a computed value (a colour that depends on the amount, a size that depends on the subtotal level) stays inline, and so does the one that the open / close code of the By task fold reads.
//   - NOT CHANGED: what anything does, the figures, the phone rows, the pop-ups (steps 17 to 27), the empty-state wording (step 15), the contrast colours (step 16).
//   - Ships on top of v0.3.143 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.143 (2026-11-25) — Staff tab: plain staff rows with a role dot, and one set of totals (index.html + sw.js; no new file, NO database RULES change)
//   - CHECKED (step 13): the figures did disagree. The Staff list, the staff profile (and its printed page) and the Record Payment list counted every entry, pending and rejected too, and only the `bags` field. Work Logs, Payments and the pay allocation count approved, finished work only, with `qty` (falling back to `bags`). On sample data (100 bags approved, 8 hours approved, 50 bags pending, 20 bags rejected, 100 paid, 50 pending payment) the Staff list said Unpaid 179 and 170 bags while Payments said Unpaid 110 and Work Logs said 108 qty. With nothing pending or rejected, and only bag tasks, they already agreed.
//   - CHANGED (step 13): one set of helpers (_stfCounted, _stfSum, _stfBalance, _stfQtyText, _stfQtyHtml) following the Payments rules: approved entries only, work entries only, open shifts left out; paid = approved payments + what was withheld at run locks. Now using them: Staff list Unpaid, Payments (role summary, each person's Unpaid tile and Total earned / Total paid), staff profile and its printed page, Record Payment list (balance and who is listed), Bulk pay balance, the staff login's own dashboard, Work Logs tiles and Earnings.
//   - CHANGED (step 13, quantity): quantity is kept per unit and shown with its unit word, never added across units: "130 bags · 8 hours". Work Logs "Total Qty (Period)" used to add bags and hours together; Earnings and the profile used to show `bags` only (0 for an hours or days task). Earnings "Total Bags" is now "Total qty"; the profile "Total Bags" is "Total qty"; the printed profile row is "Total Qty"; the staff dashboard "Bags/Units" is "Total qty".
//   - CHANGED (step 13, Earnings): the period figures there (qty, gross, deductions, net and the By Task lines) now leave out pending, rejected and open entries, as Work Logs does. A salaried person's gross is still the prorated salary.
//   - CHANGED (step 12): the staff cards were already plain rows after step 3 (initials or photo, name, status chip, role, phone, Unpaid). The role colour is now only an 8 px dot beside each role name, with the word kept. The unused tinted-card CSS (.sl-card, .sl-avatar.lo) is gone; .sl-avatar and .sl-avatar.st stay, the profile pop-up uses them (step 22).
//   - NOT CHANGED: the Payments table's running columns (they build up row by row and end at the same figure as the tile), the per-log Paid / Partial / Unpaid chips, a person who is overpaid still shows a negative Unpaid (the per-log chips cannot go below zero), role names in the Payments role summary (step 15), type sizes (step 14), the pop-ups' markup (steps 17 to 27), and the database rules.
//   - Ships on top of v0.3.142 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.142 (2026-11-25) — Staff tab: row actions in a menu, quiet status chips, one toolbar (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (step 9): each Work logs entry has one ⋯ button (Admin) that opens the action sheet: Clock out (open shifts only, first), Edit, Select, Delete. Edit shows as unavailable, with the reason, once the edit window has closed. An absence outside the edit window keeps a single delete icon. The tick boxes (and Select all) show only while selecting: Select in the toolbar or in an entry's menu turns them on; Done, Cancel on the selection bar and every finished bulk action turn them off. "Clock out" is no longer inside the date cell (the Active shifts banner keeps its own button). Payments: a paid row's edit and delete buttons are one ⋯ button (Edit, Select, Delete), and its tick boxes and Select all paid show only while selecting.
//   - CHANGED (step 10): statuses are small outlined chips with the word always shown: On shift, Overtime (was OT), Pending, Rejected, Paid, Partial, Unpaid, Absent, On leave, Sick day; in Payments also Work, Paid, Tax and Loan; the absences chip in Earnings; the type chip in the Leave log. The per-day row tints and the green open-shift tint are gone; Work logs shows a plain date header above each day (date and number of entries). The subtotal rows are unchanged. The profile pop-up still uses its old badges (steps 17 to 27).
//   - CHANGED (step 11): one toolbar under the views bar. Work logs: search, Period dropdown, Task dropdown (shown when there are two or more tasks), Select (Admin) and Export. Earnings: Period and Export. Payments: Select (Admin) and Export. Leave and Staff list: Export. The period buttons, the blue task buttons and the separate search box are gone from those views. Same period filter, same search, same export as before.
//   - CHANGED (where things went): Export left the More menu. A staff login's More menu was only Export, so the More button is hidden for a staff login. Contracts and Roles & rates have no Export button (it used to export work logs from there).
//   - FIXED: the Staff tab had no --db-* size tokens (only .dash-pro, .invx, .sfl and the bars did), so the v0.3.141 phone rows and the new chips had no size to read. .stx now has them; phone rows are slightly larger than in v0.3.141, as designed.
//   - FIXED: the Staff search boxes showed capitals despite step 5 (the global capitals rule outranked it). Typing and placeholder are now as typed.
//   - NOT CHANGED: what edit, delete, clock out and the bulk actions do, who can use them, the 24-hour edit window, the figures and sums (step 13), type sizes and radii (step 14), empty states (step 15), accessibility pass (step 16), the pop-ups (steps 17 to 27), the Role tag contrast in the light theme, and the database rules.
//   - Ships on top of v0.3.141 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.141 (2026-11-24) — Staff tab: the wide tables become rows on a phone (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (step 8): under 560 px, Work Logs, Earnings, Payments (each person's table) and Leave (balances and recent log) show one row per entry instead of a sideways-scrolling table. Work Logs: person and quantity on the first line, task and a status chip (Active, or Paid / Partial / Unpaid) on the second, then the date and time. Tap a row, or its chevron button, for role, gross, deductions, net, hours, and Qty to date / Net to date. Absence rows have the same shape (person, absence type, date). Payments rows show details and the amount, then the date and a type chip; the running Earned to date, Paid to date and Unpaid are in the tap-open part. Earnings: name and net, role and an absence chip; Total bags, Gross, Deductions and Absence notes open on tap. Leave: name and days left; entitlement, used, sick days, absences and the Log button open on tap. The Work Logs subtotal rows become a label with Qty, Gross, Deductions and Net beside it. Admin keeps the tick boxes (with a Select all above the rows) and the edit and delete buttons, which sit in the opened row.
//   - NOT CHANGED: from 560 px wide the tables are exactly as before, with every column. The tick boxes and the edit / delete buttons are still always there (step 9 moves them into a menu), the row tints stay (step 10), and the filter, the sums and the subtotals are the same.
//   - Small wording: the Payments chips "WORK" and "PAYMENT" are now Work and Payment.
//   - Ships on top of v0.3.140 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.140 (2026-11-24) — Staff tab: fewer summary boxes, no explanation note (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (step 7): Work Logs no longer shows the grey note that explained the "Cum." columns; the columns are now called Qty to date and Net to date. Its two tiles (Total qty and Net for the period) stay: they are the headline figures, and nothing else was shown there to fold.
//   - CHANGED (step 7): Payments shows one tile per person, the unpaid balance (or Fully paid). Total earned and Total paid moved into a collapsed "More figures" fold under it. Same figures, same sums.
//   - NOT CHANGED: the totals themselves (step 13), the tile look and sizes (step 14), and the Payment summary by role table.
//   - Ships on top of v0.3.139 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.139 (2026-11-24) — Staff tab: sentence case, and one slim header (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (step 5): the Staff tab's views show sentence case. Column headings, section headings and field labels are no longer forced to capitals or letter-spaced inside the tab, and the search boxes keep what you type. Status and type words are now Active, Salary, Absent, On leave, Sick day, Tax, Loan, Paid, Partial, Unpaid, Total earned, Total paid, Unpaid balance, Fully paid, Instalment withheld and Run #. Columns: Cum.Qty is Qty to date, Cum.Net is Net to date, Deduct is Deductions, and in Payments Cum.Earned and Cum.Paid are Earned to date and Paid to date. The note under Work Logs uses the new names.
//   - CHANGED (step 6): the tab has a slim header: "Staff" (or "My staff record") on the left and the number on shift on the right. It reads the same open-shift list as the Active shifts banner (_staffOpenShifts), so they cannot disagree. A staff login counts only their own shift.
//   - NOT CHANGED: the pop-ups and the printed pages (steps 17 to 27), the check marks in the Paid chips, the other capitals on the profile pop-up (its session rows share the Absent / On leave / Sick day words), and the Work Logs note and summary boxes (step 7).
//   - Ships on top of v0.3.138 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.138 (2026-11-24) — Staff tab: Roster merged into the Staff list, and no emoji (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (step 3): the Roster view is gone. The Staff list is now one view: a toolbar (search by name, role or phone; a Role dropdown when two or more roles have staff), one line of counts (people, active, suspended, inactive) and one row per person with the name, a status chip (Active, Suspended, Resigned, Terminated), role, phone and the unpaid amount. Tap a row to open the profile. A person with two roles is one row (before, they were listed under each role), and staff with no role now appear.
//   - CHANGED (step 3): Admin gets a menu button on each row with the status actions Roster had: Suspend, Mark as resigned, Terminate (active), Reinstate and Terminate (suspended), Reinstate (resigned or terminated). Each still opens the same date / reason pop-up. A Manager sees the rows and the profile, as before.
//   - NOT CHANGED (step 3): the figures. Unpaid is the Staff list's own sum (net earned over all logs, minus payments and the loan pool); step 13 checks it against Work Logs and Payments. Export as PDF still prints the staff list. A saved Roster view opens the Staff list.
//   - CHANGED (step 4): the emoji are out of the Staff tab's views: delete and edit buttons, Clock Out, the active-shift banner and chip, note and reference icons, the search box, Tag Stock, Wage Disclaimer, Generate Payslip, card titles, the leave notice, the Contract and Roles & Rates notices, the Range button and the Gang split line, plus the Contracts view (View / Download, Replace, Upload, Delete, the On file / Missing chip, History), the Roles & Rates editor and the Payments selection bar. The sync chip at the top of every tab is shared by all tabs and keeps its symbols. Each is now one of the dashboard's line icons or nothing, and icon-only buttons have a label. Pending and Rejected chips and the Edit selected / Delete selected bar use the icon form.
//   - CHANGED (wording): five pop-up messages that said "check the roster" now say "Check the Staff list".
//   - NOT CHANGED: capitals and the other wording (step 5), the pop-ups (steps 17 to 27), the check mark in Paid chips and the arrows between dates.
//   - Ships on top of v0.3.137 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.137 (2026-11-24) — Staff tab: the sub-tabs are behind a views bar (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED: the Staff tab used to show 10 pill buttons in four labelled groups (Work, Pay, People, Reports). It now shows the same slim bar as Inventory and Commodity: the name of the view you are in and a menu button that opens a sheet with the views in the same groups, the current one ticked. From 560 px wide the bar also shows a row of the main views (Work logs, Leave, Earnings, Payments, Staff list), plus the current view if it is another one.
//   - CHANGED: Role history (Admin) and Productivity (Admin and Manager) open pop-ups, not views, so they are action rows under Reports in the sheet, with no tick. Their old buttons are gone from the page.
//   - CHANGED: the bar's text sizes and corner radii now come from the dashboard's tokens on the bar itself (.vbar, .abar-m), because the Staff tab is not wrapped in the Inventory page class. This also gives the v0.3.136 More button its intended text size.
//   - NOT CHANGED: what any view shows; who sees it (a staff login still sees My logs, My leave, My earnings, My payments and My contract only, and never lands on Roster, Staff list or Roles & rates); the tab ids stab-* and the STAB value; Roster and Staff list are still two views (step 3 merges them).
//   - Ships on top of v0.3.136 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.136 (2026-11-24) — Staff tab: the action buttons are behind a More menu (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED: the Staff tab used to open with up to 12 buttons (Admin), 7 (Manager) or 2 (staff login). It now shows Clock in, Pay (not for a staff login) and a More button that opens a sheet: Record work (Bulk clock in, Bulk clock out, Log work manually, Bulk log, Gang split), Pay (Bulk pay, Payroll, Advances), People (Add staff) and Export as PDF.
//   - NOT CHANGED: what any action does; who sees it (Bulk clock out, Bulk pay, Payroll, Advances and Add staff stay Admin only; a staff login sees Clock in and Export only); the Payroll plan lock (shown in the menu); the sub-tabs, which are the next step.
//   - Ships on top of v0.3.135 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.135 (2026-11-24) — Inventory and Commodity: empty states and an accessibility pass (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (empty states): a Received or Issued view with nothing in the period shows one plain sentence and one button (Receive stock / Issue stock) in the dashboard's empty-state card, instead of a bare table row. The button presses the real + Receive / + Issue button. Commodity with no commodity defined shows "No commodities added yet." and an Add a commodity button (Admin) or a note to ask an Admin, in place of the large icon and heading.
//   - FIXED: the old "No commodities defined" block sat outside the Inventory / Commodity wrapper, so the v0.3.134 classes did not reach it; the new one is inside it.
//   - CHANGED (accessibility): the dashboard's contrast colours now apply to the whole tab (every text colour reaches 4.5:1 on a card in both themes); + Receive, + Issue and the empty-state button show a keyboard outline; the row menu button is 44 px; tick boxes are larger. The menu buttons already had labels, aria-expanded, a 44 px area and Escape to close (v0.3.122 / v0.3.123).
//   - NOT CHANGED: other empty rows (stock counts, transport, batches), what any button does, and the database rules.
//   - Ships on top of v0.3.134 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.134 (2026-11-24) — Inventory and Commodity: the dashboard's text sizes and corner radii, styles in named classes (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (sizes): both tabs now use the dashboard's five text sizes (15 / 17 / 19 / 23 / 31 px) and two radii (card 12, control 10) through the same --db-* tokens. The 11 to 40 px mix inside the views is snapped onto that scale; bars and pill shapes keep their own radius, and the large empty-state icon is left for the next step.
//   - CHANGED (code): repeated inline styles in the views of both tabs are named .iv-* classes under .invx; a style that holds a computed value stays inline. Nothing outside the two tabs uses these classes.
//   - NOT CHANGED: what any button, figure or filter does, and the database rules.
//   - Ships on top of v0.3.133 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.133 (2026-11-24) — Inventory and Commodity: search, period and export in one toolbar (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (toolbar): under the views bar there is now one toolbar instead of three separate blocks. It holds the search box (only in the four views that list entries: Inventory Received and Issued, Commodity Received and Issued), the Select button (Admin, same four views), a Period dropdown (Daily, Weekly, Monthly, Yearly, All, Range) and Export. On a phone the search has its own row and the other controls sit on the next row. All controls are 44 px tall and have labels; the Range dates show under the toolbar as before.
//   - CHANGED (where things went): the period buttons are the Period dropdown; the search box left each view and is in the toolbar; Export left the More menu and is the Export button. The Stock count, Summary, Sales and finance views get the toolbar without a search box.
//   - NOT CHANGED: what each control does (the same search, the same period filter, the same PDF export and its plan check), the + Receive, + Issue and More buttons, and the period buttons on the Staff and other tabs.
//   - Ships on top of v0.3.132 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.132 (2026-11-24) — Inventory and Commodity: statuses as quiet chips with words (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (chips): condition (Good, Damaged, Rejected), credit (Paid, Partial, Credit), Void and Refund, and the type of an internal issue are small outlined chips with the word always shown, instead of filled capital-letter pills. The colours are the dashboard's, with the same light-theme contrast fixes.
//   - CHANGED (expiry): the date is plain text, with Expired, Expires today or Expires soon beside it when it matters. Same day rule and warning days as the dashboard and the Expiry screen. A rejection reason now shows in the note under the item.
//   - NOT CHANGED: the customer history pop-up and the other screens, and anything in the database rules.
//   - Ships on top of v0.3.131 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.131 (2026-11-24) — Inventory and Commodity, Received and Issued views: one menu button per entry, tick boxes only while selecting (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (entry buttons): the edit and delete buttons of each entry are one ⋯ button. It opens the same sheet as the action menu, titled with the item or batch: Edit, Select and Delete (Admin), plus Print receipt on an Inventory issue and Trace batch or lot origin on a Commodity issue. Edit shows as unavailable, with the reason, once the edit window has closed. Where a user has one action on an entry (staff: print receipt, trace), it stays a plain icon button as before.
//   - CHANGED (tick boxes): they are hidden until you choose Select (a button beside the search box; Admin only) or Select in an entry's menu. While selecting, the boxes and Select all show, and the button reads Done. Done, Cancel on the selection bar, and any finished bulk edit or delete leave selecting and clear the ticks. The tick boxes of other screens are unchanged.
//   - CHANGED (small): the empty heading over the actions column now says Actions for screen readers. On a phone the ⋯ button sits with the other details, under the arrow of an entry.
//   - NOT CHANGED: what edit, delete, print receipt, trace and the bulk actions do, who can use them, the 24-hour edit window, the Summary, Sales and other views, and anything in the database rules.
//   - Ships on top of v0.3.130 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.130 (2026-11-24) — Inventory and Commodity, Issued view: the same layout as the Received view (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (entries): each issue is one row like a received entry. On a phone (under 560 px): item or batch, quantity, date and time, status; tap the row (or its arrow button) for the sale value and price each, the running total and the buttons. From 560 px the table is shorter: Inventory 8 columns (Admin) or 7, down from 11 or 10; Commodity 9 (Admin) or 6, down from 13 or 12.
//   - CHANGED (customer, notes, transporter): the customer (or who an internal issue went to) and the notes sit under the item name, the way the supplier does on Received; on Commodity the transporter sits under the batch. Price and sale value share one column, as cost and stock value do on Received.
//   - CHANGED (boxes): the boxes before the table are now two tiles (Issued this period with its entry count; Sales this period, only where prices exist, and for Admin on Commodity) and a "More figures" fold with the all-time issued and sales figures. The Commodity "Balance remaining" box and the formula strip are gone: the stock figure is the header's. The outstanding-credit card on Inventory is now a fold with the amount owed in its title; its table is unchanged.
//   - FIXED: the Payment heading on the Commodity Issued table sat over the wrong column, and a non-Admin user's Inventory Issued table had one more column of data than headings. Both tables now have one heading per column.
//   - NOT CHANGED: how an issue is saved, edited, deleted or traced, the Received, Summary and Sales views, the edit and delete buttons per row (the row menu is a later step), and anything in the database rules.
//   - Ships on top of v0.3.129 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.129 (2026-11-24) — Dashboard: the commodity figure is the one stock figure (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (dashboard, Commodities overview card): "In stock today", the bar, "Received" and "Issued" now come from the same calculation as the Commodity tab header and the till: received - issued - sold + returns, approved entries only (comBatchBook via _comTotals). Before, the card added every entry, pending ones included, and ignored returns, so it could differ from the tab. "Issued" is what has gone out for good (issued + sold - returned to stock), so Received - Issued = In stock on the card, and the 90% / Out of stock flags follow it.
//   - CHANGED (dashboard, alerts): the "Negative balance" alert for a commodity uses the same figures, so it appears exactly when the tab and the card show a negative stock.
//   - CHANGED (dashboard): it now runs the legacy maize migration (as the Commodity tab already did on open), because the one calculation reads the commodity lists only; an account that still held old maize rows in the legacy lists would otherwise show nothing until the tab was opened.
//   - NOT CHANGED: the stock value (still the latest unit price × stock), today's in and out, the Commodity Summary view (it still adds every entry), the General inventory table, and anything in the database rules.
//   - Ships on top of v0.3.128 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.128 (2026-11-24) — Inventory and Commodity, Received view: one stock figure, fewer boxes, entries as rows on a phone (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (one stock figure): the header figure of both tabs is worked out one way, the way the dashboard and the till do it: received - issued - sold + returns, approved entries only (Inventory: genStock summed over the dashboard's item names; Commodity: comBatchBook(...).total()). Pending entries and rejected goods are no longer in it. The "Balance remaining" box is gone, so the figure is shown once.
//   - CHANGED (summary boxes): up to 11 boxes before the table are now two tiles (Received this period with its entry count; Purchases this period, shown only where prices exist, and for Admin on Commodity) and a "More figures" fold: received, issued and sold, returned to stock (when there are returns) and, where prices exist, purchases, sales, profit and stock value. The all-time received and issued totals now follow the same rule as the stock figure, so received - issued and sold + returned = in stock. On Inventory the Financial overview card now shows on the other views only; its figures are in the fold.
//   - CHANGED (entries): on a phone (under 560 px) each entry is one row: item or batch, quantity, date and time, status; tap the row (or its arrow button) for price, stock value, good and damaged, expiry, running total and the edit and delete buttons. From 560 px the table has fewer columns: Inventory 10 (Admin) or 8, down from 12 or 11 (cost and price share one column, good and damaged share one, condition and payment share Status); Commodity 8 for Admin, down from 10 (unit price joins stock value, running cost joins running total), and 5 for everyone else, as before. Column "Item cum." / "Cum.Rec" is now "Running total". Search, tick boxes, select all, bulk edit and delete, and the CSV export work as before.
//   - NOT CHANGED: the Issued view, the Summary, the dashboard's own commodity figure (it still adds all entries, pending included), how an entry is saved, and anything in the database rules.
//   - Ships on top of v0.3.127 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.127 (2026-11-24) — Inventory and Commodity: the same slim header on both tabs (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (Inventory): the green-bordered header card is one slim bar: the title on the left and the stock figure on the right in normal text colour (it is red only when stock is below zero). The line under the title is gone.
//   - CHANGED (Commodity): the tab now has the same bar. The commodity picker is the title: a dropdown when there is more than one commodity, plain text when there is one. The figure is received minus issued for the chosen commodity, with its unit.
//   - CHANGED (look): the bar uses the dashboard's sizes (15 / 19 / 23) and corner radius (12, 10 for the dropdown), and the dashboard's light-theme contrast colours. Scoped to a new class (invx-hd), so no other screen changes.
//   - NOT CHANGED: how the figures are worked out (the Inventory figure still adds every entry and the Commodity figure still follows its Summary; one shared calculation is a later step), the Actions grid, the view tabs and everything below the header.
//   - Ships on top of v0.3.126 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.126 (2026-11-23) — receipts and slips: larger text and more line spacing (index.html + pos.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (the till's receipt, void/refund slip and X/Z report; the main app's sale receipt, till-sale receipt and void/refund slip; the subscription payment receipt): text is about 80% larger (20%, then another 50%) and the line spacing is 1.4 (main app) and 1.55 (till), up from the browser default (about 1.15) and 1.35. TOTAL is now larger than the body text. The amount box grows for large figures instead of overflowing. The logo stays centred.
//   - CHANGED (paper height): a receipt, slip or report is at least 100 mm tall, so a short one still prints on a 100 mm strip (browser print and Save as PDF; the picture and text prints to RawBT or Bluetooth trim or feed on their own).
//   - NOT CHANGED: the layout, alignment and wording, the big THANK YOU (same size as before; the RECEIPT title grows with the rest), the ESC/POS text print, the A4 documents, ID cards, labels, database rules.
//   - Ships on top of v0.3.125 (sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.125 (2026-11-23) — Inventory and Commodity: no emoji and no ALL CAPS in every view of both tabs (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (views finished): Sales history, Stock count, Item names and Summary (Inventory); Variance, Summary and Transport (Commodity); and Profit & loss, Margin, Cash flow and Budget vs actual (both). Every emoji in them is a line icon from the dashboard set or plain words, and every ALL-CAPS word is sentence case: Paid, Partial, Credit, Exact, Over, Short, Adjusted, Void, Refund, Day total, Total income, Gross profit, Net profit, Net cash flow, Below cost, No cost, Est., "Other (type below)", "+ Add" and the rest. The Title Case labels, stat labels, table headings and card titles are sentence case too ("Today closed out", "Period summary", "Cost of goods sold breakdown", "Cash in breakdown", "Set budget target").
//   - CHANGED (small): the worker emoji before "Labour" on the Budget screen is gone; the red / yellow / green circles in the variance key are coloured dots; the transport status is Delivered, In transit or Scheduled; the upgrade note on a locked Sales history and the empty Budget screen use a line icon; one icon added to the dashboard set (info).
//   - CHANGED (shared pieces, switched on from these two tabs only): the bulk "Edit selected / Delete selected" bar, the Range period button, the stock-cover badge (alert icon) and the badges. Staff logs, the dashboard and every other screen still use the old form of the bar and button.
//   - CHANGED (helpers drawn inside these views): the sync chip at the top of both tabs (alert, clock and tick icons instead of 📵 ⚠️ ☁ ✅), the lock card shown on P&L, Margin, Cash flow and Budget when the plan does not include them, the Import / Export / Labels buttons and the search box of Item names, and the labour cards (Labour cost per bag, Labour budget). Each keeps its old form for the screens outside the two tabs.
//   - CHANGED (Commodity): the commodity's own icon is also gone from the Commodity summary title (as in the picker and the heading since v0.3.123).
//   - NOT CHANGED: the receipt-number search box keeps capitals (receipt numbers are capitals); item names typed in Item names are still turned into capitals as you type (that is how they are stored: a separate decision); the pop-ups opened from these views (Receive, Issue, Stock count, Manage, Prices and so on) and every screen outside the two tabs; what any view shows; database rules.
//   - Ships on top of v0.3.124 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.124 (2026-11-23) — Inventory and Commodity: sentence case instead of ALL CAPS, and the emoji that were left in the Issued view (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (scope): both tabs are now wrapped in one scope class (invx), so the rules below reach every view inside them and no other screen.
//   - CHANGED (look, whole tabs): table headings, section headings ("Actions") and the stat labels no longer force capitals or letter spacing. The search box shows what you type as you type it.
//   - CHANGED (words, Received and Issued views of both tabs and the two headers): the status badges are Paid, Partial, Credit, Full credit, Good, Damaged, Rejected and Pending (was PAID, PARTIAL, CREDIT, FULL CREDIT, GOOD, DAMAGED, REJECTED, PENDING), Void and Refund on a return, the "Commodity:" label is plain, and the Title Case labels are sentence case: General inventory, Financial overview (all time), Cumulative purchases, Total received, Balance remaining, Period issued, All-time cumulative, Purchase price, Stock value, Date & time and the rest of the table headings, the key lines under the Commodity tables, "Outstanding credit / debts", "No commodities defined", "Add commodity", "Maize handling".
//   - FIXED (step 3 leftovers in the Issued view): the label on an internal issue (for example "Staff use") had its own emoji in front, and the filter row had two (Internal, Sales); the return chip had an arrow, and so did the receipt chip on a returned item (now "Return R-0012"). All of them are plain words now. The emoji are still stored in Settings and still show in the issue pop-up.
//   - CHANGED (badges): the Pending and Rejected badges have sentence case only in these four views; other screens keep PENDING and REJECTED.
//   - NOT CHANGED: the group labels STOCK, SALES, FINANCE no longer exist in these tabs (the views menu from v0.3.123 has them in sentence case); the other views of the two tabs (Stock Count, Item Names, Sales History, Variance, Summary, Transport, P&L, Margin, Cash Flow, Budget) lose the forced capitals from the style rules but their own ALL-CAPS words and emoji are still there; the bulk Edit / Delete bar and the period buttons; every other screen; database rules.
//   - Ships on top of v0.3.123 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.123 (2026-11-23) — Inventory and Commodity: the sub-tabs behind a menu, no emoji (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (views bar): the 11 pill tabs of Inventory and the 8 of Commodity are one slim bar: the name of the view you are in (for example "Received stock") and a menu button (named "All views"). The button opens the same bottom sheet as the More button, with the views in their groups (Inventory: Stock, Sales, Finance; Commodity: Stock movement, Finance), the current view marked with a tick and aria-current, and the lock kept on Sales history and Till when the plan does not include them. Till still opens the till (it is not a view) and is still hidden in the Play build.
//   - CHANGED (wide screens): from 560 px wide the bar shows the main views as one row of tabs (Inventory: Received stock, Issued, Stock count, Summary; Commodity: Received, Issued, Variance, Summary), plus the current view when it is another one, and the menu button for all of them.
//   - FIXED (colour): the selected tab was blue, except P&L and Margin (green), Cash Flow (blue) and Budget (amber). The selected view is now one colour, the accent green, in the bar and in the menu, and says so in words as well (aria-current).
//   - CHANGED (no emoji): in the Inventory and Commodity tabs' header, card titles, Received and Issued views (both tabs): the tab names, the Inventory title and Financial Overview, Received Stock Overview, All-Time Cumulative, the search boxes (an icon inside the box; the placeholder is plain text), the supplier and notes lines, the edit, delete, print-receipt and trace buttons (each with a name for screen readers), the rejected label, the pending and rejected badges, the customer name, Outstanding Credit / Debts, the two key lines under the Commodity tables (the coloured words stay) and the empty Commodity screen. Three icons were added to the dashboard set: edit, trash and search.
//   - CHANGED (Commodity): a commodity's own icon is no longer shown in the Commodity picker or in the "Handling" heading, as on the dashboard since v0.3.114. It is still stored and still shows in Settings.
//   - NOT CHANGED: what every view shows, the tabs' ids, GTAB / MTAB and every link into them (dashboard alerts, the header menu), who sees what, the other views (Stock Count, Item Names, Sales History, Variance, Summary, Transport, P&L, Margin, Cash Flow, Budget) which still have emoji, the bulk Edit / Delete bar and the period buttons (shared with other screens; step 9 and 11), the Staff, Contacts and every other screen, database rules.
//   - Ships on top of v0.3.122 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.122 (2026-11-23) — Inventory and Commodity: the action buttons move behind a menu (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (Inventory): the Actions grid of up to 13 buttons is now two buttons, + Receive and + Issue, and a "More" button with a menu icon. The menu opens as a sheet from the bottom, in groups: Count (Stock count, Scan count), Bulk entry (Multi receive, Scan receive, Multi issue), Stock tools (Expiry, Reorder, Transport), Setup (Manage, Prices) and Export (Export as PDF). A group with nothing in it for the signed-in role is left out.
//   - CHANGED (Commodity): the grid of up to 8 buttons is the same two buttons and "More". Its menu has Count (Stock count), Bulk entry (Multi receive, Multi issue), Setup (Manage, Prices) and Export (Export as PDF).
//   - CHANGED (look): the menu items have the flat line icons of the dashboard (no emoji), sentence case and a short line saying what each one does. Eight new icons were added to the dashboard icon set (menu, scan, clipcheck, layers, truck, sliders, tag, close); no existing icon changed.
//   - CHANGED (keyboard and screen readers): the More button is named "More actions" and says whether the menu is open (aria-expanded). The sheet is a dialog; focus moves to its first item, Tab stays inside it, Escape closes it, and focus goes back to the More button. Every menu row is at least 52 px tall. Back (the phone's back gesture) and a tap outside the sheet close it, as for every other pop-up.
//   - NOT CHANGED: what each action does (same functions), who sees what (Reorder: Admin and Manager; Manage and Prices: Admin only), + Receive and + Issue (same buttons and ids), the sub-tabs, the period buttons, the header and summary boxes, the tables, every other screen, database rules. Steps 2 to 14 of the Inventory and Commodity plan (sub-tab menu, emoji, capitals, header, stock figure, boxes, tables, row menu, chips, toolbar, sizes, empty states, accessibility check) are not in this version.
//   - Ships on top of v0.3.121 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.121 (2026-11-23) — main dashboard: empty and loading states, accessibility (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (empty state): with no commodities the dashboard says "No commodities added yet." and, for an Admin, shows one button, "Add a commodity", which opens the same Manage Commodities box as Settings. Anyone else sees "Ask an Admin to add them." (only an Admin can add commodities).
//   - CHANGED (loading): the Sales today tile and the Till today card used to show a false "0 sales" / "No shift is open" for a moment while the sales ledger and the shift records were read from the phone. They now show grey placeholders instead, on top of the real content (nothing moves). A placeholder never stays longer than 4 seconds from the first paint of the dashboard: the CSS swaps it out by itself, so a failed or empty read cannot leave one on screen. Only till users (Admin/Manager with the till feature) ever see them; the Open till button works throughout. No motion with "reduce motion" on.
//   - CHANGED (not by colour alone): a commodity with nothing left now says "Out of stock" beside its figure, and one that is 90% or more issued says "Nearly all issued" (the red figure and the amber bar said it only in colour). Each alert says its severity in words for screen readers ("Urgent:", "Act soon:", "Needs review:"). The inventory table's Out / Low / OK words, the alert titles and the trend text were already words.
//   - CHANGED (contrast): inside the dashboard only, red text is lightened in the dark theme (4.16:1 -> 5.5:1 on a card) and the muted, amber and green text is darkened in the light theme (3.5 / 3.7 / 4.5:1 -> 5.5 / 5.7 / 5.4:1), so every dashboard text colour reaches 4.5:1 (WCAG AA) on a card in both themes, and the light green button now has 5.1:1 text. Other screens keep the shared colours.
//   - CHANGED (keyboard): "Reorder list" and "+ N more · open Stock" in the Till today card were clickable divs, which the keyboard could not reach; they are buttons now, with the same green focus outline as the other dashboard buttons. The "View all alerts" button now names the list it opens (aria-controls).
//   - NOT CHANGED: the figures, which commodities and items show, the alert rules, every other screen, the shared colours, database rules. Ships on top of v0.3.120 (pos.html, sales.js and shifts.js as in v0.3.118).
// Previous version: v0.3.120 (2026-11-23) — main dashboard: slim top bar, lighter commodity cards (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (top bar): the welcome box is now a slim bar: the company name, then the date in normal case (and the place, when set) on the left; the user name with a small role label on the right. The "Signed in" caption is gone. The day of the month has no leading zero ("3 December", not "03 December").
//   - CHANGED (commodity cards): each card now reads "In stock today" and one figure (23 px, not 31 px extra bold) with the unit beside it, the stock value as a quiet line, and a thin neutral bar. The two boxes (Total received, Total issued) and the "Issued vs received" heading are gone: the same numbers are in the one line under the bar ("Received N unit", "Issued N · P%"). The figure is left-aligned like the other cards.
//   - CHANGED (bar colour): the bar is grey. It turns amber when 90% or more has been issued and red when nothing is left (it used to go amber at 60% and red at 90%, so most commodities were coloured most of the time).
//   - NOT CHANGED: the figures, which commodities show, the inventory table, every other screen, database rules. Ships on top of v0.3.119 (and v0.3.118's pos.html, sales.js and shifts.js).
// Previous version: v0.3.119 (2026-11-23) — main dashboard: inventory balances as a table (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (inventory balances): each item was a block that showed its balance twice (top right and in a "Balance" line) with a progress bar. It is now one row of a table: Item, In, Out, Balance, Status. The Status is a word as well as a colour: Out (nothing left, red), Low (amber), OK (green). Reserved and Available show in small print under the item name, only for items that have a reserved quantity. The bar is gone.
//   - CHANGED (Low): an item with a minimum stock set is Low when it is at or below that minimum, the same rule as the Low stock tile and alerts. An item with no minimum set is Low under 5, as before.
//   - NOT CHANGED: the figures (genStock), the order of the items, the "Opening + Received − Issued = Balance" line, the commodity cards (they keep their bar), every other screen, database rules. Ships on top of v0.3.118 (shifts.js, sales.js and pos.html as in that version).
// Previous version: v0.3.118 (2026-11-23) — shifts.js follows the same date rule (index.html + sw.js + shifts.js; no new file, NO database RULES change)
//   - CHANGED (shifts.js): its three fallback date rules (used only when a caller passes no dateOf; index.html and pos.html always do) were still the UTC date. They now use the device's own date, like the rest of v0.3.117. A shift that runs across midnight now sells on two dates (it used to be across 02:00 Zambia time); the shift is still listed on the one day it was closed.
//   - CHECKED: Shifts.dayReport's net total and sale count are the same sums the dashboard's "vs yesterday" line now works out from the ledgers (sales less returns made that day; a digest counts its n).
//   - NOT CHANGED: everything else in v0.3.117 below (ship it together), saved records, database rules. returns.js has still not been checked.
// Previous version: v0.3.117 (2026-11-23) — "today" follows Zambia time; the "vs yesterday" line no longer depends on shifts.js (index.html + pos.html + sales.js + sw.js; no new file, NO database RULES change)
//   - FIXED (dates): the app's date was the UTC date, so from 00:00 to 02:00 in Zambia "today" was still the previous day (sales, receipts, the till, the dashboard and the close-out all showed yesterday's date). It is now the device's own calendar date (a phone set to Zambia time is UTC+2). The same rule is used by index.html (today(), the sale / return / shift ledgers' dateOf, the stock-take stamp), pos.html and sales.js, so a sale and its Sales History row always land on the same day.
//   - FIXED (print period): "This month", "Last month", "This quarter" and "This year" in the print-period box and the assistant's date ranges started or ended one day early in Zambia (a local midnight turned into the UTC date). They now use the local date.
//   - FIXED (yesterday): the dashboard's "Up / Down N% vs yesterday" line now works out both days straight from the sale and return ledgers (the same sums as Sales History) instead of calling shifts.js. If the ledger has not been read from this device yet, the line is left out, so an empty list is never shown as "No sales yesterday". If shifts.js ever fails, the Sales today tile still shows (from the ledgers).
//   - NOT CHANGED: records already saved keep the date they were saved with (a sale made between 00:00 and 02:00 before this version stays on the earlier day), nothing is moved, database rules, what any button opens. shifts.js and returns.js are not part of this version; they take their date from the dateOf that index.html and pos.html pass in.
// Previous version: v0.3.116 (2026-11-22) — main dashboard: shorter alerts, one main action, headline numbers first (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (alerts): the alert box lists the worst first (stock or money wrong, then approvals, then act-soon), folds alerts of one kind into one row ("Low stock — 5 items" with the first three names) and shows three rows. "View all N alerts" opens the full list, "Show fewer" closes it. Every alert has one short button that goes to the fix (Review count, Open stock, Reorder list, Write off, View batches, Review). The "→" links inside the messages are gone: the buttons replace them. Item names in alert titles are now escaped.
//   - CHANGED (quick actions): two columns on a phone (four from 560 px wide), icon beside the label, quiet buttons. "Open till" is the one filled button (in the Till today card when that shows; otherwise the full-width button at the top of the quick actions). Without the till feature it stays a plain wide button with the lock.
//   - CHANGED (numbers): the row of tiles now sits right under the header and leads with Sales today (net, number of sales, and "Up/Down N% vs yesterday"), then Low stock (red if something is at zero, amber if low), then the commodity tiles (hidden when no commodity is set up), stock entries and staff logs. The Till today card no longer repeats Net sales today when the tiles show it. Money on the dashboard has thousands separators and no ".00" when there are no cents.
//   - NOT CHANGED: what each button opens, the figures themselves, the status banner, the period buttons, the staff and cashier home screens, every other screen (zm() is unchanged everywhere else), database rules.
// Previous version: v0.3.115 (2026-11-22) — main dashboard: one accent colour, fixed text sizes and corner radii, styles moved into classes (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (colour): the dashboard uses one accent (green) for its icons, links and main button. Cards and tiles lose the green/amber/blue/purple borders and numbers; figures are neutral. Red and amber now appear only for real warnings: an empty or low balance, a negative or short figure, an expiring or expired batch, an old open shift, and the alert icons (red = stock or money is wrong, amber = act soon, green = a task waiting).
//   - CHANGED (size and shape): five text sizes (15 / 17 / 19 / 23 / 31 px) and two corner radii (12 px cards, 10 px buttons and boxes) replace about eleven sizes and four radii. Cards are flat (no shadow). The "Issued vs received" bar now has a visible track.
//   - CHANGED (code): the dashboard's inline styles are now classes (.db-card, .db-tile, .db-qa-b, .db-al ...), all in one block at the end of the stylesheet and all scoped to .dash-pro. Only the bar widths stay inline (they come from the data). The old coloured quick-action styles (.qa-btn-*) were removed.
//   - NOT CHANGED: what the dashboard shows and does (same figures, buttons and handlers), the status banner, the period buttons, the staff and cashier home screens, every other screen, database rules.
// Previous version: v0.3.114 (2026-11-22) — main dashboard: no emoji, sentence case instead of ALL CAPS (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED: on the admin/manager dashboard the emoji (alerts, quick actions, card titles, till card, recent activity, books) are now small flat line icons, and the forced capitals are gone: alert titles, the "N alerts need attention" heading, section headings, tile labels, the date line, the user name and role tag, IN/OUT/BAL/RSRV/AVAIL (now In / Out / Balance / Reserved / Available) and "UNITS IN STOCK AS AT TODAY" (now "In stock today (unit)"). Commodity and item names show as they were typed. Title-case labels on the dashboard are now sentence case.
//   - FIXED: "1 ALERT REQUIRE ATTENTION" and "2 ENTRYIES AWAITING APPROVAL" now read "1 alert needs attention" and "2 entries awaiting approval".
//   - NOT CHANGED: the status banner at the top (online / trial / offline: shared by other screens), the staff and cashier home screens, every other screen, the Display Preferences list, stored data (a commodity's chosen icon is kept, it is just no longer shown on the dashboard), database rules.
// Previous version: v0.3.113 (2026-11-22) — sign-in screen: removed the "general-purpose tool" sentence under the Terms checkbox (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED: the line "I understand this is a general-purpose tool and all data I enter is my responsibility." no longer shows under the Terms of Service / Privacy Policy checkbox. The unused .au-check-sub style was removed with it.
//   - NOT CHANGED: the checkbox itself and how it is checked, the Terms of Service and Privacy Policy pop-ups (their wording is the same), every other screen, database rules.
// Previous version: v0.3.112 (2026-11-22) — no emoji on the sign-in, sign-up and recovery screens (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED: the messages and buttons on Sign in, Create account (including the "Before you continue" notice) and Account recovery no longer start with an emoji: terms not accepted, wrong username or password, too many attempts, no account data, cannot reach the server, account on a different shop, "Verifying…", "Restoring data…", fingerprint messages, the free-trial welcome and the password-reset pop-up. The wording is the same.
//   - NOT CHANGED: every screen after sign-in (a few pop-ups there still carry an emoji), the license and trial banners, the blocked-account screen, IDs, function names, database rules.
// Previous version: v0.3.111 (2026-11-22) — sign-in screens say "shop", not "depot" (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED: the words on the Sign in, Create account and Account recovery screens: the two lines in the PC side panel ("Set up your shop in minutes", "Smart shop management") and the sign-in message for an account that belongs to a different shop ("different shop", "that shop", "shop admin").
//   - NOT CHANGED: every other screen, the Terms and Privacy text, stored data (including a company's saved name), IDs, function names and code comments, database rules.
// Previous version: v0.3.110 (2026-11-22) — Account recovery screen: same look as Sign in (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED: the recovery screen now uses the sign-in look: a plain "Account recovery" heading with one short line, one card, normal-case labels, 48px fields and buttons, one error box, no emoji and no coloured option boxes. When a Recovery PIN and a recovery email are both set, the two ways sit under their own headings with an "or" between them.
//   - CHANGED: the messages on that screen lost their emoji; the "Code sent" message is shown in green and a later error is shown as an error again (before, the box stayed green).
//   - NOT CHANGED: how recovery works (PIN check, email code, lockout after wrong tries, the new password rules), every ID and function name, database rules.
// Previous version: v0.3.109 (2026-11-22) — sign-in screens: the PC side panel uses the landing page's line icons (index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED: on a PC or wide tablet, the left panel of Sign in, Create account and Account recovery now shows the landing page's three points (Works offline, Till on every plan, Any phone or PC) with flat line icons instead of the coloured emoji tiles. The panel is flat (no gradient). Each screen keeps its own title and short line.
//   - CHANGED: the line-icon set moved out of the landing screen so the sign-in screens can use it while the landing page is hidden.
//   - NOT CHANGED: phone layout, every ID and function (sign in, sign up, username check, fingerprint, recovery), database rules.
// Previous version: v0.3.108 (2026-11-21) — the cash drawer opens by itself when cash changes hands (pos.html + index.html + sw.js; no new file, NO database RULES change)
//   - NEW: Printer > "Cash drawer (plugged into the printer)": Off (default), standard connection, or the other pin. It sends the ESC p drawer pulse through the printer, so it needs a drawer in the printer's drawer socket and RawBT or Bluetooth printing (the browser print dialog cannot send it). Per device, like the rest of Printer.
//   - NEW: the drawer opens (1) when a sale has cash in it (any cash tendered, also in a split payment), (2) when a void or refund hands cash back, (3) when a shift is opened (the float goes in) and (4) when a shift is closed (the cash comes out). On a sale or a return that prints by itself, the pulse is the first thing in the receipt's / slip's own print job, so RawBT gets one hand-off; otherwise the pulse goes alone.
//   - NOT OPENED: MTN, Airtel, card or credit-only sales, practice sales, reprints, X and Z reports, the receipt preview. An Admin or Manager's Test print also opens the drawer so they can check it; a cashier's Test print does not.
//   - LIMIT: a drawer shuts by hand. The app cannot close it or tell whether it is open (most drawers have no sensor). Pulse timing is 100 ms on / 500 ms off; if a drawer stays shut, try the other pin.
//   - NOT CHANGED: every figure, receipts, slips, reports, the main app's printing (index.html only has its version number changed), database rules.
// Previous version: v0.3.107 (2026-11-21) — X and Z reports carry a barcode, like the receipt (pos.html + index.html + sw.js; no new file, NO database RULES change)
//   - NEW: the X report and the Z report end with a Code 128 barcode of the shift number (the "No." under the title), under the closing line and a dashed line, in the same place and size as the receipt's barcode of its number. On screen and in print it is drawn by barcode.js; on a thermal printer (RawBT and Bluetooth) it is printed as a picture.
//   - CHANGED: Settings > Printer, the barcode tick box now reads "Print a barcode at the bottom: the receipt number, or the shift number on X and Z reports". It is the same switch: off means no barcode on thermal receipts and reports. (The void/refund slip has no barcode, as before.)
//   - NOT CHANGED: every figure, the rest of the report, receipts, slips, the day's Z report in the main app, database rules. If barcode.js cannot draw the shift number, the report prints without the barcode, as a receipt does.
// Previous version: v0.3.106 (2026-11-21) — X and Z reports are built like the receipt and the void/refund slip (pos.html + index.html + sw.js; no new file, NO database RULES change)
//   - CHANGED (screen and print): the report's head is the receipt's: big bold X REPORT / Z REPORT between double dashed lines, "No. <shift id>" under it, then the till, cashier and dates as centred lines, then the FINAL / READING ONLY tag (and COPY), as the receipt puts its number, date and tag.
//   - CHANGED: amounts have the symbol (K) in its own column with the figure on the right, like the receipt's item lines; the key totals (TOTAL SOLD, NET SALES, TOTAL COLLECTED, CASH EXPECTED) are bold capitals like TOTAL AMOUNT, and the money-collected lines, CASH COUNTED and SHORT / OVER are bold capitals like CASH / CHANGE. Sections are separated by dashed lines and each is kept whole on one page when printed.
//   - CHANGED: items sold read "2x Name" / "6 bag x Name" on one row with the amount (the same line as on a receipt), instead of a bold name with the quantity under it.
//   - CHANGED: the closing is the slip's: signature lines (Z only), a big KEEP THIS REPORT (Z) / READING ONLY (X) and one small line with the shift id.
//   - CHANGED (thermal, RawBT and Bluetooth): the report is now drawn with the same printer kit as the receipt and slip (escposKit): same title size and wrapping, the symbol column, bold capitals for totals, items as the receipt prints them, and the same closing. The COPY mark prints as [COPY], like the receipt's tag line.
//   - CHANGED (wording only): "Offers applied (n)" and "Discounts given (n)" no longer carry ", already off the total" in the label; that sentence is its own small line under the section (the thermal report already worked that way).
//   - NOT CHANGED: every figure, what each report records, who may take or reprint one, the audit entries, the day's Z report in the main app (a full-page A4 document), receipts, slips, payslips, labels, receipt numbers.
// Previous version: v0.3.105 (2026-11-21) — receipts and slips: the lines v0.3.103 / v0.3.104 dropped are back; layout, fonts and sizes unchanged (pos.html + index.html + sw.js; no new file, NO database RULES change)
//   - BACK: the unit price under each item ("2 × 185.00") on the till's receipt and void/refund slip (screen, print and thermal) and on the main app's sale receipt, till-sale receipt and void/refund slip.
//   - BACK: the "N items / N units" line under the total of the till's receipt (screen, print and thermal).
//   - BACK: the "Powered by Shop Inventory & Sales Manager" line (with the shop name) at the foot of the main app's sale receipt, till-sale receipt and void/refund slip.
//   - BACK: the full wording "Thank you for your business!" where the receipts only said THANK YOU (till receipt, thermal receipt, main app sale receipt and till-sale receipt). Same big style as before; the thermal title now wraps at half the width (double-width letters), which only matters for a long title like this one.
//   - NOT CHANGED: the template layout, Arial, the sizes, the title, the symbol column, TOTAL AMOUNT, CASH / CHANGE, the barcode, the Z report, payslips, labels, receipt numbers and every figure. Not restored (not asked for): the "PAID - SETTLED IN FULL" box and the initials box.
// Previous version: v0.3.104 (2026-11-21) — receipts and slips follow the receipt template: Arial, large text that fills the paper, a big title, a barcode (pos.html + index.html + sw.js; no new file, NO database RULES change)
//   - NEW: the till's receipt, void/refund slip and X/Z report, and the main app's sale receipt, till-sale receipt and void/refund slip share one layout taken from the template: a big bold RECEIPT / REFUND / VOID title between double dashed lines, "2x Name" with the symbol (K) in its own column and the figure on the right, TOTAL AMOUNT, CASH / CHANGE in bold capitals, a big THANK YOU and a Code 128 barcode of the receipt number (drawn by barcode.js).
//   - NEW: every size is a multiple of 1% of the paper's width (never below a readable minimum), so the text fills the paper whatever its width: 58 mm, 80 mm, a phone screen or an A4 page. In print the paper is the whole page.
//   - NEW: the thermal printer prints the same lines with a double-size title and THANK YOU, dashed lines, the symbol column, and the barcode as a picture (Printer settings > "Print a barcode of the receipt number", on by default; Test print shows it).
//   - CHANGED: the unit price ("2 x 185.00") is no longer printed under each item (the template has none); the "N items / units" line and the "Powered by ..." line are gone.
//   - NOT CHANGED: the day's Z report, payslips, staff cards, labels, Books documents and A4 reports (full-page documents), the receipt numbers and every figure.
// Previous version: v0.3.103 (2026-11-20) — one paper style for receipts and slips: the sample receipt on the sign-in page (pos.html + index.html + sw.js; no new file, NO database RULES change)
//   - NEW: the till's receipt, void/refund slip and X/Z report, and the main app's sale receipt, till-sale receipt and void/refund slip, all use the sample receipt's look and wording: business name, "Receipt K7F2-000123" on one line, dashed rules, the item name and its amount on one row with "2 × 185.00" under it, "Total" with the symbol (K586.00; lines and payments are plain numbers), the payments and "Change", one footer line. On screen the paper is monospace on cream with a torn edge. The thermal text (RawBT and Bluetooth, and the main app's text style) has the same lines.
//   - CHANGED: no initials box when the shop has no logo (the sample has none); the "N items / N units" line, the "PAID - SETTLED IN FULL" box and the "Powered by ..." footer line are gone from receipts; "SALES RECEIPT / #number" became "Receipt number".
//   - NOT CHANGED: the day's Z report, payslips, staff cards, labels, Books documents and A4 reports (they are full-page documents, not slips), the receipt numbers and every figure.
// Previous version: v0.3.102 (2026-11-20) — Receive stock on the till: the whole Scan Receive form and Save, from the till screen (pos.html + index.html + sw.js; no new file, NO database RULES change)
//   - NEW: each scanned item on the till's Receive stock screen is a card with the same fields as the main app's Scan Receive: quantity, cost, damaged, expiry, batch / lot and "Another batch of this item". Below the list: supplier, date received and payment, and the total cost.
//   - NEW: "Save delivery" runs the same checks as the main app (a quantity on every line, damaged not above the quantity), asks once, then the main app opens for a moment, stores the delivery exactly as Scan Receive always does (stock, cost price, Audit line, cloud sync) and brings the till back. No second form, no second question. "Open in main app" is still there for a new product or an unknown code.
//   - WHY THE MAIN APP STILL DOES THE WRITE: received stock lives in DATA.generalInventory, one blob, last write wins, and only index.html writes and syncs it. A till-side write would need a new append-only ledger plus an import in the main app: not done here.
//   - NOT CHANGED: a normal Scan Receive in the main app (its Save still asks "Proceed?"), sales ledger, shifts, sync, database rules, gate.js, sales.js, shifts.js, returns.js.
// Previous version: v0.3.101 (2026-11-20) — Receive stock: scan on the till itself (also with a linked scanner phone) and print the stickers (pos.html + index.html + sw.js; no new file, NO database RULES change)
//   - LIMIT 1 FIXED: v0.3.100 opened the main app's Scan Receive, so a WiFi-linked scanner phone (which feeds the till, not the main app) could not be used. Now the till's "Receive" button opens a Receive stock screen on the till: its scan box / hardware scanner, its camera and a linked scanner phone all add to the delivery (exact barcode, SKU or pack barcode, one scan = one more, the same rule as the main app's _srScan; items with no price can be received; commodities are received in the main app).
//   - The delivery is kept as the SAME unsaved draft the main app keeps (localStorage mdm_srdraft_<install>_<user>, same shape), saved after every scan. "Continue in main app" (manager PIN while a shift is open, like Main app; the open sale is parked) opens Scan Receive with that draft already loaded, without the "continue it?" question, for cost, damaged, expiry, supplier and Save. Close keeps the draft; Discard throws it away.
//   - While Receive stock is open no scan can reach the sale: the sell box, the camera and the linked phone all go to the delivery.
//   - LIMIT 2 FIXED: after Save from the till an Admin gets the same sticker offer as in the main app (items with an in-store barcode, copies = quantity received): "Print stickers" opens the label printer, closing it brings the till back; "Back to till" skips. No offer (not an Admin, nothing to print): back to the till on its own, as in v0.3.100.
//   - NOT CHANGED: a normal Scan Receive in the main app, sales ledger, shifts, sync, database rules, gate.js, sales.js, shifts.js, returns.js.
// Previous version: v0.3.100 (2026-11-20) — Receive stock from the till, first form: the button opened the main app's Scan Receive (v0.3.99 was never released). Its notes: — Receive stock from the till (pos.html + index.html + sw.js; no new file, NO database RULES change). v0.3.99 was never released.
//   - NEW: a "Receive" button in the till's header (Admin and Manager only, hidden for a Cashier). It uses the same manager-PIN rule as "Main app" while a shift is open, parks an open sale, then opens the MAIN APP's Scan Receive straight away.
//   - WHY NOT INSIDE THE TILL: received stock is DATA.generalInventory. The till never writes DATA (one blob, last write wins; its cloud sync and audit belong to index.html), so a second Scan Receive in pos.html would fight the main app. This is the same hand-off Change password uses (sessionStorage mdm_till_sr, like mdm_till_cp).
//   - Save: the delivery is saved exactly as Scan Receive always saves it (stamped, audit line, cost prices), pushed to the cloud now (8 s at most), then back to the till, which reads the new stock on load. Cancel: straight back. Refused (read-only, no permission): the usual message, then back.
//   - CHANGED in a normal Scan Receive: nothing. Only when opened from the till is the barcode-sticker question skipped (stickers stay in the main app).
//   - NOT CHANGED: sales ledger, shifts, sync, database rules, gate.js, sales.js, shifts.js, returns.js.
// Previous version: v0.3.98 (2026-11-20) — Landing page blank with no explanation: a loading screen now shows at once, then names the missing file or the exact start-up error, with retry buttons (index.html + sw.js; no new file, NO database RULES change)
//   - SYMPTOM: the page stayed dark with only the full-screen button. The landing page is hidden until index.html's main script runs, and that script sits behind five plain <script src> downloads (gate, sales, shifts, returns, barcode) that block one after another. On a weak signal, or when the main script threw an error before showLanding(), nothing was drawn and nothing was said.
//   - FIX 1 (index.html): boot splash right after <body>. Shows the app name and a spinner immediately. After 6 s it says which of gate.js / sales.js / shifts.js / returns.js is still missing and shows "Try again" and "Clear saved app files and try again" (service worker + caches only, never the shop's data). If the main script throws before the landing page is up, the splash shows the error text and file:line instead (take a screenshot). The main script removes it with __bootOk() right after showLanding().
//   - FIX 2 (index.html): <link rel="preload"> for the five shared scripts, so they download together instead of one after another.
//   - FIX 3 (sw.js install): the best-effort precache step (manifest, sales, shifts, returns, qrcode, barcode, pos.html, fonts) now has a 20 s limit. A download that hangs on a weak signal used to hold the install, and skipWaiting(), back with no limit. The shell and gate.js are still required first, as before.
//   - NOT CHANGED: fetch rules, the load guard, pos.html, sync, database rules.
// Previous version: v0.3.97 (2026-11-19) — Blank screen on a dead or weak signal, round 2: the start-up waits no longer add up, a script that cannot be had now fails with a message instead of hanging, index.html's guard now covers all four files (sw.js + index.html; no new file, NO database RULES change)
//   - WHY v0.3.96 STILL FAILED (measured, headless Chromium, every request hanging as on a WiFi router with no internet): with everything cached the app took 24 s to start, not 4.5 s. The 4 s wait of v0.3.96 was paid by EACH file in turn (page, gate.js, sales.js, shifts.js, returns.js, barcode.js: a <script src> blocks the next one). And if one script was not in the cache (its precache download had failed on a weak signal) the page hung with no message at all, because with nothing cached the worker waited for the network without a limit.
//   - FIX 1 (sw.js, netOrCache): once a wait has run out and the cache has answered, the network counts as slow for NET_SLOW_MS (60 s): cached files are then answered after NET_SLOW_WAIT_MS (0.3 s) instead of 4 s. Downloads still carry on in the background and refresh the cache. A good answer from the network ends the slow state at once. Dead network, everything cached: 24 s -> 6 s.
//   - FIX 2 (sw.js, networkFirst): a script or the manifest with NO cached copy waits at most NET_HARD_MS (10 s; 5 s while the network is known to be slow). It then looks in the cache once more and, if still empty, fails. The download carries on in the background and fills the cache, so the page guard's automatic reload usually finds it. The page itself (a navigation) is never cut off this way: with nothing cached there is nothing else to show.
//   - FIX 3 (index.html): the load guard now sits after returns.js and checks gate.js, sales.js, shifts.js and returns.js, like pos.html's. One automatic reload, then a message naming the missing file, with "Try again" and "Clear saved app files and try again" (service worker and caches only, never the shop's data). Retry flag is still _gate_retry. Before, a missing sales.js, shifts.js or returns.js left the page half-working.
//   - NOT CHANGED: install and activate, pos.html (its guard from v0.3.96 is as it was), the sync, the database rules. The 4 s wait for the page itself (NET_WAIT_MS) is as in v0.3.96.
// Previous version: v0.3.96 (2026-11-19) — Blank screen on a weak signal: a slow network no longer holds the page back, the till page gets a load guard (sw.js + pos.html + index.html; no new file, NO database RULES change)
//   - SYMPTOM A (pos.html): if gate.js, sales.js, shifts.js or returns.js did not load, the till page stayed completely blank ("Gate is not defined", "Sales is not defined", ...). v0.3.95 guarded only index.html.
//   - SYMPTOM B (sw.js): navigations and the shared scripts were network-first with NO time limit. On a weak signal the browser waited for the shell (or a synchronous <script src>) while a good copy sat in the cache, and the screen stayed blank until the network gave up.
//   - FIX 1 (pos.html, right after returns.js): same guard as index.html, but for all four files the till cannot start without. One automatic reload, then a plain message that names the missing file, with "Try again" and "Clear saved app files and try again" (service worker and caches only; the shop's data is not touched). Its retry flag is _pos_retry, separate from index.html's _gate_retry.
//   - FIX 2 (sw.js netOrCache): the network still goes first, but if it has not answered within NET_WAIT_MS (4 s) and a cached copy exists, the cached copy is served at once. The download carries on in the background and refreshes the cache, so the next visit has the new files. With nothing cached the page still waits for the network, as before. A bad answer (404 / 5xx) is replaced by the cached copy; a redirect is passed through untouched.
//   - FIX 3 (sw.js): barcode.js and qrcode.js were precached but never served from the cache (the fetch rule only matched gate|sales|shifts|returns), so offline they never loaded. They now use the same rule.
//   - FIX 4 (sw.js): a copy of a good answer is now made BEFORE the answer is handed to the page. Cloning afterwards can fail with "body already used" and silently skip the cache update.
//   - FIX 5 (index.html CSP): connect-src had no 'self', which silently blocked the page's own cache.add() calls for the shell and pos.html. 'self' added; nothing else in the policy changed. pos.html makes no same-origin requests, so its policy is unchanged.
//   - NOT CHANGED: install and activate, gate.js and the other files, the sync, the database rules, index.html's own gate guard (it still checks gate.js only, as in v0.3.95).
// Previous version: v0.3.95 (2026-11-19) — Blank white page fix: a failed gate.js can no longer be answered with index.html (sw.js + index.html; no new file, NO database RULES change)
//   - SYMPTOM: the page opened blank except the full-screen button. gate.js is the one file the app cannot start without. When its request failed (weak signal) and it was not in the cache, networkFirst() handed back the app shell, so the browser tried to run HTML as a script ("Unexpected token '<'", then "Gate is not defined") and the main script stopped before it drew anything. Reproduced in a headless browser.
//   - HOW A PHONE GOT THERE: the install step cached the files one after another, so one slow download (the 2 MB shell) skipped every file after it, skipWaiting() still ran, and activate deleted the previous cache. The phone was left with no cached gate.js.
//   - FIX 1 (sw.js networkFirst): a failed request with nothing cached now fails honestly (Response.error()); the shell is never returned for a script or the manifest. A bad answer (404 / 5xx) is replaced by a good cached copy when there is one.
//   - FIX 2 (sw.js install): the shell and gate.js must be cached or the install FAILS, so the previous version and its cache keep running and the browser tries again on the next visit. Everything else stays best-effort, and one failed file no longer stops the files after it. Same-origin files are fetched with cache:"reload" so a deploy never caches a copy the host's HTTP cache is still holding from before.
//   - FIX 3 (index.html, right after gate.js): if Gate is still missing, one automatic reload, then a plain message with "Try again" and "Clear saved app files and try again" (service worker and caches only; the shop's data is not touched). No more blank page.
// Previous version: v0.3.94 (2026-11-19) — Extra sites, step 10 (till and stock checked against pos.html, sales.js, shifts.js, returns.js, gate.js, till_verify.js): the depot switch now uploads this phone's till records first (index.html + sw.js; no new file, NO database RULES change)
//   - CHECKED, NO CHANGE NEEDED: the till keeps everything per depot, so a site's till never meets the main depot's. Till code + receipt counter: localStorage mdm_till_v2:<depot> (gate.js receiptNumbering); sales, returns and shifts: IndexedDB records and upload queues indexed by depot; held baskets, cart drafts and the scanner target: keyed by depot; the shift lock: mdm_shift_<depot>. A site claims its own till code in depots/<site>/tills/. Signing out never deletes the till stores (only the main-data database is cleared by a reset). till_verify.js reads any depot node, and an export with an empty site depot gives 0 errors.
//   - GAP FOUND AND FIXED: the main app uploads till sales and returns only while that depot is open (salesSync), and the switch only saved the data blob. Sales made offline on this phone stayed in its queue until you came back to the depot. siteSwitchPrepare now, after the data is saved, runs salesSync() and pushes the shifts (best effort, 8 seconds at most, it never blocks or fails the switch) and counts what is left. If any are left the sign-in notice says how many and that they go up on return. Nothing is lost either way.
//   - GUIDE: one more row in the Extra sites messages table.
//   - NOT CHECKED: scripts/mdm-backup.mjs was not uploaded. The nightly check (mdm-nightly-backup.yml) covers a site only if that script exports every depot, not a fixed list.
//   - TESTS: sites_test.js section 3c: order (sync, sales upload, shifts upload, sign out, login), a failing or hanging upload does not stop the switch, the left-over count and the notice, no till calls when the sync fails or offline. 
// Previous version: v0.3.93 (2026-11-19) — Landing page headline now says "shop" (index.html + sw.js; no new file, NO database RULES change)
//   - LANDING: the headline reads "Run your shop\u2019s stock, sales and staff from one app" (was "depot\u2019s"). Nothing else on the landing page was changed; other "depot" wording there (Depot Assistant, "when your depot needs more", sign-up and login subtitles) is left as it was.
// Previous version: v0.3.92 (2026-11-19) — Extra sites, step 13 (in-app part): User Guide chapter "Extra sites: more than one shop" (index.html + sw.js; no new file, NO database RULES change)
//   - USER GUIDE: new Admin-only chapter after "Plans, limits and read-only mode": what a site is, before you start, add a site (4 steps), switch between depots, plans and prices for a site, stock/till/staff, and a table of the messages you can meet. Three new explanations (extra_site, site_login, site_switch) and a Go button (set_sites -> Settings > My Sites).
//   - SHOWN ONLY WHERE SITES ARE ON: the chapter carries gate:'sites' and the guide's visible() now asks sitesVisible() (switch ON, or the depot is a site, or it has sites). With the switch off nothing about sites appears in the guide, in its search, or anywhere else. The chapter is also left out of the Play build (np:true, no prices).
//   - NOT CHANGED: every other chapter, the Words and Troubleshooting chapters (adding site text there would show it with the switch off), signupFinish, doLogin, the sync, gate.js, the admin, the database rules.
//   - TESTS: sites_test.js section 8 (11 checks): gate on/off, Play rule kept, every [[i:..]] link and the Go button resolve, no other chapter mentions sites. 178 checks pass in all.
//   - STILL TO DO: step 13 outside the app (landing and pricing cards, Ask NEXLITE answers, WhatsApp post: needs the website and worker files) and step 14 (All sites summary).
// Previous version: v0.3.91 (2026-11-19) — Extra sites, steps 4-12 of 14: Add a site, My Sites, the switcher, extra-site prices in a site, admin badge and checks, expiry warning (index.html + mdm-admin.html + sw.js; no new file, NO database RULES change)
//   - RULES: none. v0.3.90's siteOf rule is all this needs. The creation steps were walked, in order, through a stand-in that mirrors the rules for every path they touch (usernames, licenses, licenseContacts, authorizedUids, auth, data, meta, and the rollback deletes).
//   - ADD A SITE (Settings > My Sites; main depot Admin only; needs internet; switch ON; up to 10 sites): site name + the owner's password. The steps run in the order signupFinish uses: reserve the login name (owner login + site, e.g. mutale_mansa), licence (normal free trial), contact email, Firebase login (made on a second app instance, so this phone stays signed in as the main owner), this phone and then the site owner authorised as admins of the new depot, login copy, the new depot's data (owner user, currency, parentSite), and LAST the row in DATA.sites. The depot is named "Main depot \u2013 Site name", so receipts and the till show that name.
//   - IF A STEP FAILS: after the authorising step everything is rolled back (login name, then the new depot, are deleted: this phone is an admin of it by then). Before that step nobody is an admin of the new depot yet, so it cannot be undone: the login name may stay reserved and the message says so (try a slightly different site name; an orphan trial licence is operator-only to delete). Either way the site never appears in the main list half-made.
//   - SWITCHER: a header chip (admins, once there is a second depot) and Settings > My Sites list the main depot and every site with its status (Trial / Active, days left, View-only, Free plan). Open = save this depot to the cloud (if that fails you are NOT signed out), sign out, open the login screen with the other depot's owner login filled in. After that login a site refreshes its copy of the site list (DATA.parentSite.sites) from a one-use hand-off in localStorage (mdm_site_handoff, 15 minutes, only accepted by the depot it names and only from its own main depot). A site also has Back to main depot.
//   - PRICES IN A SITE: every logged-in plan screen (limit-reached, upgrade, plan picker, My Plan, locked-feature card, subscription form) quotes planPriceOf(), which is extraSiteQuote() in a site and the plan price everywhere else. The request carries siteOf, planPrice (the extra-site price quoted) and the label "(extra site)". Play build: still no prices.
//   - ADMIN: a site request shows "Extra site of <main>", the quoted price next to the expected extra-site price, and an automatic check that the depot is in the main depot's own site list (read from depots/<main>/data/sites). Approval is unchanged (Lifetime still has no expiry); the confirmation adds a warning when the check fails or the price differs. Depot cards show "Extra site of" / "Its sites"; MRR counts a site at the extra-site price. Links are read only for depots with the switch ON (plus any main depot a pending request names).
//   - MAIN DEPOT BANNER: statusBanner() adds a warning when a site has 7 days or fewer left, or is already view-only. Each site keeps its own licence, so an unpaid site goes view-only on its own; nothing else was needed.
//   - NOT CHANGED: signupFinish, doLogout, the sync, fbSet/fbGet, gate.js, the till (pos.html and sales.js were not part of this change and were not available to check). doLogin has exactly one added line (the after-login hook). With the switch OFF and no sites nothing is drawn and no new request is made.
//   - NOT DONE YET: step 13 (User Guide chapter, landing and pricing cards, Ask NEXLITE answers, WhatsApp post: needs the website and worker files) and step 14 (All sites summary).
// Previous version: v0.3.90 (2026-11-19) — Extra sites, steps 1-3 of 14: rules field, admin rollout switch, data fields and helpers (database_rules.json + mdm-admin.html + index.html + sw.js; no new file)
//   - RULES CHANGE (publish database_rules.json BEFORE deploying the rest): subscriptionRequests/{id}/{ts} accepts an optional siteOf (a string, up to 64 characters: the main depot's install id). Nothing else changes in the rules.
//   - ADMIN: every depot card has an "Extra sites: OFF / ON" button (licenses/<id>/extraSitesOn, true or removed). The licence's $other rule already lets only the operator write it. Off by default.
//   - APP: LICENSE.extraSitesOn is read with every licence check and kept in the offline copy. New helpers beside hasFeature(): sitesSwitchOn, parentSite, siteList, isSiteDepot, siteRole, sitesVisible, canAddSite, MAX_SITES (10). New optional DATA.sites (main depot) and DATA.parentSite (site depot), not in DEFAULT.
//   - NOTHING IS SHOWN YET: no screen uses the helpers until step 4 (Settings > My Sites). With the switch off for every depot this release changes nothing a customer can see.
// Previous version: v0.3.89 (2026-11-18) — Plans: the flat K600 Multi-Site plan is gone; new Lifetime plan (one payment, never expires); the admin sets what an extra site costs (index.html + gate.js + mdm-admin.html + database RULES + index.html SW_VERSION + sw.js; no new file, no new field on any depot record)
//   - REMOVED: the Multi-Site plan (it was never sold) from the plan list, prices, limits, tier ladder, admin price box and the tierPrices rules. A licence that still says tier 'multisite' is read as Pro (gate.js normTier), in the app, the till and the admin, so nobody drops to Free. The first price save in the admin deletes the old stored tierPrices/multisite value.
//   - NEW PLAN Lifetime (tier 'lifetime'): exactly Pro's features, one payment (default K1900, set in the admin), no end date (activeUntil 0 = active with no expiry, as gate.js already treated it). Shown on the landing page, Plans & Pricing, sign-up and upgrade screens as "K1900 once-off"; the Plan card says "never expires"; no renewal banner. Admin: approving a Lifetime application sets tier lifetime with no expiry, Renew says nothing to renew, and Lifetime is not counted in monthly revenue (MRR).
//   - NEW PRICE SETTINGS (admin, Plan Prices): Extra site price = a percentage (0-100) of the plan's monthly price, rounded to the nearest K5 (Free is worked out from Starter so Free is not a way to get free sites); Lifetime extra site = its own once-off price. A live table shows what each extra site costs on every plan. The app reads them (EXTRA_SITE, extraSiteQuote) but does not sell extra sites yet: nothing about extra sites is shown to customers until the sites feature itself ships.
//   - RULES CHANGE: tierPrices accepts lifetime, extraSitePct (0-100) and extraSiteLifetime; multisite is no longer accepted. Publish database_rules.json BEFORE deploying: until then saving prices in the admin is refused (the admin says so) and the apps keep their built-in prices.
// Previous version: v0.3.88 (2026-11-18) — Till: the cart bar is no longer pushed off the bottom of the screen in the installed app (pos.html + index.html SW_VERSION + sw.js; no database RULES change, no new file, no new field on any record)
//   - Cause: some Android windows report a page height taller than the part you can see, so the bottom-anchored cart bar sat below the screen until the person pinch-zoomed. 100dvh was trusted as the height.
//   - Fix: fitView() sizes the page (and the full-screen sheets: receipt, payment, scanner camera, lock) to the visual viewport, re-checks on resize, rotate, return to the app and 0.3/1/2.5 s after load, and if the cart bar is still below the visible edge it takes the difference off. A zoomed-in page is left alone.
// Previous version: v0.3.87 (2026-11-18) — Phone scanner on a PC till: the till shows a QR with its own till code and the scanner phone scans it (pos.html + index.html SW_VERSION + sw.js; no database RULES change, no new file, no new field on any record)
//   - pos.html: 📲 on the till has Show till QR for a phone (starts receiving, then shows a code holding only the 4-character till code, which is not a secret). 📲 on the scanner phone has Scan till QR: a strict parser takes only MDM1:t|CODE, then the dialog opens with the code filled in and the person taps Start scanning, so every existing check still runs. No webcam is needed on the till.
//   - pos.html: a browser that cannot read QR codes (Chrome on Windows and Linux, iPhone) now says so, instead of waiting silently, when Pair a phone by QR or Scan till QR is used.
//   - Limit, unchanged: Pair by QR with no internet needs the till to READ the phone's QR code, so a PC without a QR reader cannot do it. Scanner-phone Start scanning still checks the till code online.
//   - index.html User Guide: new section Using a PC as the till, one new tip (till_qr), three screen messages, updated steps.
// Previous version: v0.3.86 (2026-11-18) — User Guide: new chapter "Using a second phone as a scanner" (index.html + pos.html + sw.js; no database RULES change, no new file, no new field on any record)
//   - index.html User Guide: new chapter (setup, QR pairing, screen messages, safety habits), five new tips, one step in Selling at the Till, three Troubleshooting steps, one Words row. Fixed text only, no internals (no database paths, record names or QR contents) shown.
//   - pos.html Till help: new item 13 Phone as scanner (Stay safe is now 14).
// Previous version: v0.3.85 (2026-11-18) — Phone scanner: link the two phones by QR code with NO internet (pos.html + index.html SW_VERSION + sw.js + NEW FILE qrcode.js; no database RULES change; no sale record changes)
//   - NEW FILE qrcode.js (Kazuhiko Arase's qrcode-generator, MIT licence, unchanged): pos.html loads it and sw.js precaches it. Deploy it next to pos.html.
//   - Scanner phone: a Pair by QR button on its camera screen shows a QR. Till: 📲 then Pair a phone by QR scans it and shows its own QR, which the scanner phone then scans. The QR holds only the WebRTC details (about 200 characters); nothing goes through the database, and the till can now start receiving with no internet.
//   - Needs both phones on the same router. Android Chrome reads QR codes natively; the iPhone camera reader (barcode.js) does not read QR.
// Previous version: v0.3.84 (2026-11-18) — Phone scanner over the shop WiFi: the two phones link directly (WebRTC), so scans keep working with no internet (pos.html + database RULES + index.html SW_VERSION + sw.js; no new file, no new field on any sale)
//   - Pairing goes through the existing scans node (records with code '@offer' / '@answer'), so it needs internet ONCE per link. After that the phones talk directly over the router; the till answers each scan at once (item name or error). If the link drops, scans go through the internet as in v0.3.83, with the same id, so a scan is never added twice.
//   - The receiving till keeps its screen on while receiving (wake lock). No STUN server: both phones must be on the same router; guest WiFi often blocks phone-to-phone traffic.
//   - RULES CHANGE: one optional field on a scan record, sdp (a string, up to 6000 characters). Publish database_rules.json BEFORE deploying. Not part of till_verify.
// Previous version: v0.3.83 (2026-11-18) — Phone scanner: a second phone scans with its camera and sends the barcodes to a till through the database (pos.html + database RULES + index.html SW_VERSION + sw.js; no new file, no new field on any sale)
//   - NEW in pos.html: a \uD83D\uDCF2 button in the search bar. "Start receiving" on the till; on the scanner phone type that till's 4-character code and "Start scanning" (the usual camera screen, but it sends instead of adding). Needs internet on both phones; offline use stays with a Bluetooth/USB scanner.
//   - NEW database node depots/<depot>/scans/<till code>/<id> (RULES CHANGE: publish database_rules.json BEFORE using it). Transient: the till deletes each scan as it takes it, and clears the node when receiving starts. Not part of till_verify.
//   - Safe by design: a scan is added at most once (taken by deleting first), goes through resolveCode() like the scan box, is dropped after 15 s if the till is paying or locked, and the scanner phone tells you if the till did not take it.
// Previous version: v0.3.82 (2026-11-18) — In-app User Guide, Till help, and two small fixes (index.html + pos.html + sw.js; no database RULES change, no new field on any record, no new file: nothing new to precache)
//   - NEW: 📖 User Guide in index.html. Opens from the ☰ menu (every role), Settings > Help & About / Account & Help, the Setup Checklist pop-up, and the Cashier home card. Chapters are filtered by role (Admin, Manager, Staff, Cashier; "Show all chapters" shows the rest), with search, a 15-step set-up in order with live ticks, Till, stock, staff, money, security, plans, offline and troubleshooting chapters, and ⓘ buttons that explain a word or setting in a sheet.
//   - SAFE BY DESIGN. All text is fixed in the code and built with createElement + textContent (no innerHTML, no inline handlers). An ⓘ or a "Go to" button carries only a key into a fixed list. It reads DATA / TIER_* for ticks, plan limits and 🔒 tags and writes nothing, calls no network, stores nothing on the phone. Go-to buttons call the normal screens, which keep their own admin checks. It closes itself on sign-out. Play mode leaves out the Till, prices and plan chapters. Plan prices in the guide come from TIER_META (so they follow tierPrices).
//   - NEW: a ? (help) button at the start of the till header (pos.html, kept small so the header does not get tighter): a short 13-line "how to use the Till" sheet, the same read-only way, so a cashier can find help without the main app. Closed by the lock screen. Counts as an overlay (anyOverlay) and Escape closes it.
//   - FIX: the Setup Checklist step buttons called switchTab(), which was never defined (a ReferenceError on tap). They call showTab() now.
//   - FIX: Settings > Wholesale prices was drawn for the Admin but no Settings category matched its title, so it never appeared and wholesale could not be switched on. 'Wholesale prices' is now listed with Account & Security, next to Till discounts.
//   - Not changed: database rules, sales.js, returns.js, shifts.js, gate.js, barcode.js, till_verify.js, what any screen writes to DATA, the audit log.

// Previous version: v0.3.81 (2026-11-17) — Till settings: theme, stay logged in with a lock screen and PIN, PIN, and change password (pos.html + index.html + sw.js; no database RULES change; sales.js, returns.js, shifts.js, gate.js, barcode.js untouched)
//   - NEW: a Settings button (and, once a PIN exists, a Lock button) in the till header. Settings holds four things, all for the till only.
//   - THEME. Auto / Light / Dark, kept in this phone's localStorage mdm_pos_theme (the main app keeps its own mdm_theme). The till stays Dark until someone changes it, as before. The receipt paper and the camera view are the same in both.
//   - STAY LOGGED IN. Per login, on this phone. Switched on: the till is never logged out for being idle. It LOCKS after 1 / 2 / 5 (default) / 10 / 15 / 30 minutes and the same login types its PIN. It also keeps the sign-in across an app restart (same record as the main app's Stay Signed In).
//     The lock survives a reload (mdm_pos_locked), and a phone that was put away, or an app that was closed, for longer than the idle time opens locked. A password or fingerprint login in index.html counts as use, so a fresh sign-in is not met by the lock.
//     Wrong PINs: 5 in a row pause the pad 30 seconds, 10 pause it 2 minutes, 15 log the user out (password needed again). The lock screen also has Log out. The cart, the open shift and any open sale screen stay as they were behind the lock.
//   - PIN. 4 to 6 digits, saved on this phone as a salted PBKDF2 hash (never the PIN), per login. Setting, changing or removing it needs the account password (checked on the phone; the cloud only for an old password format). It is NOT the manager PIN (Settings > Manager PIN in the main app), which still approves discounts, refunds and leaving the till.
//   - PASSWORD. Settings > Change password opens the main app on a small box (current password, new password, confirm), saves it exactly as Settings > Change Password does, pushes the sync, and returns to the till. Leaving the till this way follows the same "manager PIN to leave the till" rule as Main app / Log out.
//   - NOT changed: the database rules (nothing new is written to the cloud), what a till writes to DATA (nothing), the audit log (no new event names).
// Previous version: v0.3.80 (2026-11-17) — Plan prices are set in the admin app and every price in the main app follows (index.html + sw.js + mdm-admin.html + database_rules.json: RULES CHANGE, publish database_rules.json)
//   - NEW NODE tierPrices/{starter,growth,pro,multisite,updatedAt} in the database. Public read (the landing page shows prices before anyone signs in), written only by the operator account. Free is always K0 and has no price record.
//   - ADMIN APP: new "Plan Prices" panel (set the four monthly prices, with a confirmation that shows old and new). The Subscription Revenue panel (MRR, revenue by plan) and the application cards now use the same prices instead of their own copy.
//   - MAIN APP: the numbers in TIER_META are now only the fallback. refreshTierPrices() reads tierPrices at the landing page, the Plans & Pricing page, and with every licence check (login, coming back to the app, the manual refresh), and when the phone comes back online. The last prices seen are cached in localStorage (mdm_tier_prices_v1), so an offline phone shows the most recent ones. Screens that are open when prices change repaint themselves.
//   - Two prices were typed into the page instead of read from TIER_META and are now live: the plan dropdown in sign-up, and "plans from K150/month" in the trial-ending banner (it is the Growth price).
//   - An upgrade application now records planPrice (what the screen quoted), the subscription receipt prints that amount, and the admin app shows it, so a price change never alters an application already submitted. New optional field planPrice on subscriptionRequests/{id}/{ts}: it needs the new rules to be accepted.
//   - Not changed: till, returns, shifts, gate.js, barcode.js, pos.html, till_verify.js and the nightly backup (the backup copies tierPrices with the rest of the database; till_verify only reads depots).
// Previous version: v0.3.78 (2026-11-17) — Barcodes: label printing, a camera button in the item form, and camera scanning on iPhone (index.html + pos.html + sw.js + NEW FILE barcode.js; no database RULES change, no new field on any record)
//   - NEW FILE barcode.js (index.html AND pos.html load it, like sales.js): EAN-13 / UPC-A / EAN-8 / Code 128 drawing, A4 label sheets, thermal label pictures, and a camera reader. Deploy it next to index.html. It is in the sw.js precache list.
//   - LABELS. Item list (Manage or the Inventory Item Names tab) > Labels, and Details > Print label. Tick items, set the number of stickers, choose: A4 paper (sticker sheets 24 / 14 / 65 up, or plain A4 with dotted cut lines; "first free label" lets a part-used sheet be reused;
//     browser print dialog or Save as PDF) or a thermal roll through RawBT (a picture per label, whole-dot bars so they scan, dotted cut line). Shows name, selling price (optional), shop name (optional), bars and digits.
//     Items with no barcode: "Make in-store barcodes for them" gives each a number starting with 2 and saves it. After Scan Receive, items with an in-store barcode offer stickers (copies = quantity received).
//     Admin only, plan feature pos_till (same as Scan Receive; one line in openLabelPrinter()). Per-device settings in localStorage mdm_label_prefs. Printing a label changes no record; it writes one audit line.
//   - CAMERA IN THE ITEM FORM. A camera button beside the Barcode box (and each pack/carton barcode box) reads one barcode into the box. It refuses a code another item already uses.
//   - IPHONE / DESKTOP CAMERA. Browsers with no BarcodeDetector (Safari on iPhone, desktop Chrome on Windows/Linux) now get one from barcode.js, so the camera buttons of the Till, Scan Receive, Scan Count and the item form appear there too. Browsers that have their own (Chrome and Samsung Internet on Android) keep using it.
//   - LIMITS. The fallback reader reads EAN-13, EAN-8, UPC-A and Code 128 only (not QR, Code 39, ITF, UPC-E), needs the barcode roughly upright or on its side and a fair size in the picture, and is slower than the native reader. A USB/Bluetooth scanner is still best at a busy till.
//     Thermal labels need the printer paper width set in Settings > Printer and RawBT; ESC/POS printers only (not label printers that speak TSPL/ZPL). The Bluetooth-direct printer of the Till is not used for labels yet.
//     Sticker sheets differ between makes: check the sheet size on the pack; use "plain A4" if unsure and print at 100% (Actual size).
// Previous version: v0.3.77 (2026-11-17) — Till roadmap step 35: thermal receipts over Bluetooth, and X/Z reports on the thermal printer (pos.html + index.html SW_VERSION only + sw.js; no database RULES change, sales.js, returns.js, shifts.js and gate.js untouched)
//   - WHAT WAS ALREADY THERE. Receipts and void/refund slips already printed as ESC/POS through the free RawBT app (v0.3.52-v0.3.57). That is the Bluetooth bridge for printers RawBT can reach, classic SPP printers included. It still works exactly as before.
//   - NEW 1: Till > Printer > Print with > "Bluetooth thermal printer, direct". The same ESC/POS bytes go to a Bluetooth LOW ENERGY printer with Web Bluetooth, so no helper app. Connect printer opens Chrome's device chooser (needs a tap);
//     the link then stays open while the page lives and re-opens by itself if it drops; after a reload getDevices() finds the printer again where Chrome has it, otherwise one tap on Print or Connect printer. Auto-print after a sale never opens the chooser:
//     if the printer is not connected the receipt stays on screen and Print connects and prints. Data goes in small pieces (100 bytes, stepping down to 60 then 20 if the printer refuses), one job at a time.
//   - LIMITS. Web Bluetooth sees only Bluetooth LE printers; many cheap 58 mm printers are Bluetooth Classic and will not appear: pair those in Android settings and use RawBT. It needs Chrome: it works in the browser and is expected to work in the PWABuilder
//     (Trusted Web Activity) app, which runs on Chrome, but that is to be tested on a real printer; it does NOT exist in a WebView app such as the old Median build, which must keep using RawBT. The main app (index.html) prints through RawBT or the browser as before: it reads only mode 'rawbt' as "printer on".
//   - NEW 2: X reports, Z reports (and the Z copy) print on the thermal printer. Before this, the Till's report Print button always opened the browser print dialog, even with RawBT switched on. Same layout as the screen, as text, at the chosen paper width and text size.
//     The item list is capped at 60 items as on screen; Z reports carry two signature lines. Reports are not auto-printed (Chrome allows the RawBT hand-off and the Bluetooth chooser only right after a tap); the Print button prints.
//   - Settings stay per device (localStorage mdm_till_printer, new field bleName). No new file, no new field on any record, nothing uploaded. Tills can update one at a time.
// Previous version: v0.3.76 (2026-11-17) — Cloud sync of the shared data blob (doFbSync / fbRestoreData) now MERGES instead of overwriting (index.html + sw.js; no database RULES change: depots/{key}/data has no .validate, so id-keyed paths and _devTs/{phone} are allowed)
//   - WHAT IT SOLVES (8 data-loss limits). Two phones adding to the same list wrote the same position and erased each other; a phone that was behind uploaded its whole old copy over newer data; after two simultaneous saves the phone that wrote last never downloaded the other's row; the 60 s pull replaced the whole local copy and dropped an edit still waiting in the 2.5 s push delay; a phone brought back to the foreground pushed without pulling; a save with nothing to save still moved _syncTs; the 2000-entry audit log re-wrote every position on each event (2000 paths, ~287 KB).
//   - ROWS BY ID. A list whose rows all have an id (users: a username) is stored as  <list>/r~<seq>~<id>  instead of <list>/<position>. Two phones adding rows write different keys. An audit event is 2 paths (add + trim). A list the cloud still holds as a plain array is read as if it had those keys and is converted only when that list next has something to write (rows written under their keys, old numeric slots nulled in the same update). Lists with an id-less row stay whole, as before.
//   - STAMPS. Besides _syncTs every phone writes _devTs/{its id}. A phone that sees _syncTs or ANY other phone's stamp different from what it last saw reads the cloud and merges it piece by piece (a row, a scalar, a whole list): only-the-cloud-changed -> taken, only-this-phone-changed -> kept and sent, both changed -> this phone's version kept (and a toast says so); a delete never beats an edit. After a write it looks at the stamps again and merges again if another phone wrote meanwhile.
//   - NOTHING TO SEND = NOTHING WRITTEN (_syncTs does not move). _lastFbSync, _v and _syncTs are local bookkeeping and are no longer synced as data. The pull reads two tiny stamps first and only downloads the blob when something changed (it used to download the whole blob every 60 s).
//   - RESUME. Foreground now pulls (merge) and then pushes. Download from Cloud / new-phone login read the blob through _fbDecode so lists come back as arrays.
//   - ROLL-OUT. A phone still on v0.3.75 cannot read a list that has been converted to id keys (it expects an array). The update flow reloads every open tab, so this only affects a phone that has not been online since the deploy; it is fixed by opening the app once with data. Do not roll back to v0.3.75 on a depot whose lists have been converted.
//   - KNOWN RESIDUAL. Two phones writing the SAME row at the same instant is still last-writer-wins (the loser is told by a toast). Positional lists that are stored whole (staff roles, reasons ...) are still last-writer-wins at list level.
//
// Previous version: v0.3.75 (2026-11-16) — Till roadmap step 33: older days of the sales ledger are held as day totals in memory (sales.js + shifts.js + pos.html + index.html + sw.js; no database RULES change, no change to any record, returns.js and gate.js untouched).
//   - WHAT IT SOLVES. Both pages read the WHOLE sales ledger into memory and rebuilt every row whenever a sale arrived. With the real sales.js and 3-line sales over 400 items that held about 175 MB at 100,000 sales and 530 MB at 300,000,
//     and the rebuild alone took 0.35 s and 1.1 s. The first two clauses of step 33 were already true (steps 9, 16, 19: one IndexedDB record per sale, pushed one by one to sales/{saleId}, create-only). This step is the third: archive old days.
//   - NOTHING IS DELETED, here or in the cloud (the rules still only allow a sale to be created). Every record stays in IndexedDB. What changes is what a phone holds in MEMORY: the last N days (default 120, Admin sets 30-730 in Sales History >
//     "Older days", kept in depotInfo.ledgerHotDays, written to the audit log) as the real records, older days as DIGESTS: one pseudo sale per day, till, shift and cashier (Sales.foldCold). Its lines are that group's per-item totals, its payments
//     the per-method totals, `n` the sales it stands for. Every engine reads it like a sale, so stock, batches, expiry, margin, reorder, the Z item list and every total come out the same (sums in whole ngwee, quantities to 3 places).
//   - KEPT AS REAL RECORDS, for ever: a sale with a customer, anything on credit or part-paid, a discount a person allowed (the audit log names who), a wholesale basket, any sale a void / refund points at, and any record that looks odd.
//     A refund made against a folded sale brings that sale back as a real record on the next load.
//   - THE CACHE. sales.js load() keeps the folded days in this device's IndexedDB (meta cold:<depot>), so a start does not read the whole ledger: the first load folds the days (3-5 s for 300,000 sales in the test on a computer; a phone will be slower), later ones took 0.2-0.4 s in the same test. It is DERIVED, never a source:
//     checked against the records (count per day) once per start and rebuilt if they disagree; a record that arrives dated before its boundary (late upload, restore) marks its day to be worked again; a longer window gives the days back.
//   - IndexedDB "mdm_sales" goes to version 2: a day index (['depot','rec.date']) is added in place, existing records are indexed as it is made, nothing is rewritten. A tab still running the OLD code cannot open version 2 (VersionError) until it reloads:
//     the update flow reloads every tab. Do not roll back to v0.3.74 on a phone that has opened v0.3.75 without clearing the site data.
//   - SALES HISTORY. A cold day is one row per till, shift and cashier marked DAY TOTAL (n sales, items, payments). A new "Find a receipt" box prints ANY receipt by its number, read from the phone on demand (the plan's history limit still applies).
//     The till's refund screen does the same for a full receipt number. The backup export writes EVERY sale (all()), not the day totals.
//   - shifts.js counts a digest as the n sales it stands for (saleCount, noShift, the offer count promoN), so day reports and shift summaries keep their counts.
//   - WHAT AN OLDER DAY NO LONGER SHOWS: the list of its anonymous paid receipts (find one by number), the time of each sale (a day total sits at its last sale's time, so stock "as at" a minute INSIDE a cold day is only exact to the day), per-sale payment
//     references and the price mix of one item within a day (revenue and quantity are exact; a price is the day's average). The figures the engines produce were compared with the full ledger and matched (see Tests); the screens were not run in a browser here.
//   - MEASURED (same 400-item benchmark): 100,000 sales: 175 -> 86 MB; 300,000 sales: 529 -> 171 MB (1,500 items: 193 MB); a reload with 100,000 sales takes about 0.25 s. The saving is a FACTOR (sales per day / distinct items per day), not a ceiling: memory still
//     grows with the number of days. If it ever matters, the next lever is monthly totals for days older than a year (not built).
//   - Tests: test_cold.js (132,420 checks: 25 random histories against the full ledger for stock at any day, issuedRows, day reports, shift summaries and item lists, audit lines, batches with backdated and mid-day deliveries, margin, reorder; the store
//     against the pure fold through a new day, a second tab, a longer window, a refund, a late sale, a damaged cache, two loads at once) and test_cold_idb.js (a fake IndexedDB: the v1 -> v2 upgrade, range / each / countBefore, the store on top).
//     scripts/till/ may keep its copy of sales.js and shifts.js: till_verify.js reads the cloud records, which have not changed.
// Previous: v0.3.74 (2026-11-16) — Till roadmap step 32: reorder suggestions from minimum stock and stock cover (sales.js + index.html + sw.js; no database, rules, pos.html, returns.js, shifts.js, till_verify.js or gate.js change).
//   - REORDER LIST. General > Stock > "Reorder" (also in the header menu, in the dashboard's low-stock alert and in the Till Today card), Admin and Manager: which items to order and how many. Nothing is stored about the list:
//     Sales.reorderBook() (sales.js) works it out from the records stock already reads. AVAILABLE = genStock's balance (the one stock formula) less the item's reserved quantity and less stock past its expiry date (the till will not
//     sell it). RATE = what customers took per day over the last N COMPLETE days (today is left out): till sale lines + priced Issue Item rows, less void / refund lines of any kind; internal issues and write-offs are not demand.
//     A young item is averaged over the days it has existed (marked "only N days of sales to go on" under 7 days). COVER = available / rate.
//   - THE RULE. Safety = the item's minimum stock. REORDER POINT = safety + rate x supplier days: an item is listed when what is available is at or below it. ORDER UP TO = safety + rate x (supplier days + days to hold); the order is that
//     minus what is available, rounded up to a whole base unit. An item at or under its minimum is always listed (the old low-stock alert's test, on the smaller available figure, so the list is never shorter than the alert). Status: OUT, LOW,
//     ORDER SOON; an item with no minimum and no sales in the window is never listed. At its minimum with no recent sales there is nothing to size an order from: it is listed with no quantity.
//   - THREE NUMBERS, set by the Admin on the screen (defaults 3 / 14 / 30 days): days the supplier takes (0-90), days of stock to hold after a delivery (1-180), days of sales to average (7-365). Kept in depotInfo
//     (reorderLeadDays, reorderCoverDays, reorderLookDays) inside the DATA blob like the discount limits, so they sync like any setting and database_rules.json needs no change. Saving is written to the audit log.
//   - SHARE and PDF. Share sends the list (item and quantity only, no cost) through the phone's share sheet, or copies it. PDF is the usual export (needs export_csv). The estimated cost uses each item's current purchase price; items
//     with none are left out of the total and counted.
//   - Not plan-gated (no new feature key, gate.js unchanged): it reads the same stock and minimums the Low stock alert does. Staff and Cashier logins do not see it (it shows purchase prices).
//   - NO CHANGE TO RECORDS: no new fields on sales, returns or items; nothing uploaded; pos.html does not call reorderBook, so the tills do not have to update together. Only index.html calls Sales.reorderBook, so sales.js and
//     index.html must go out together (both are precached; the CACHE bump above refreshes them). scripts/till/ may keep its copy of sales.js: till_verify.js does not use reorderBook.
//   - Test: test_reorder.js (the engine against the real sales.js and returns.js: hand-worked cases, the stock figure from stockBook with returns, 400 random histories against a brute-force day-by-day calculation).
// Previous: v0.3.73 (2026-11-16) — Till roadmap step 31: margin reports using cost (sales.js + index.html + sw.js; no database, rules, pos.html, returns.js, shifts.js, till_verify.js or gate.js change).
//   - MARGIN. General > Finance > "Margin" (also in the header menu): gross profit and margin % by item or by category, for the period buttons' period, from COST. Nothing is stored: Sales.marginBook() (sales.js)
//     sums the records stock already reads. Revenue = what was really taken (line totals after discounts, offers and wholesale prices) less voids / refunds on the day they were made, plus priced Issue Item rows
//     (internal issues carry no price, so they are never margin). COST of a sale = the average price paid for the PRICED stock received up to that moment (approved, not rejected, purchasePrice > 0; at the same minute
//     a receive counts first, as in stockBook), so a later price rise never rewrites an old margin. Nothing priced received yet: the item's current cost, marked EST. No cost at all: NOT COSTED, shown on its own and
//     left out of the margin %, never guessed (coverage says what share of the revenue has a cost). A refund takes back the cost the SALE had; goods that come back damaged (restock:false) keep their cost.
//     Packs and cartons cost their base units. Money is worked in whole ngwee per line, so rows, categories and totals add up to the ngwee.
//   - NOT INCLUDED: commodities (bought in bulk, shown under purchases in the P&L; their revenue is reported apart), write-offs and stock-count losses. VAT is not separated (amounts as entered).
//   - DIFFERS FROM THE P&L on purpose: the P&L costs every sale at the average of ALL receipts ever (also later ones); the Margin report costs each sale as at its own moment. They agree while prices are steady.
//   - Pro, behind the same switch as the P&L (profit_loss): no new feature key, so gate.js is unchanged. The period is the app's own filterPeriod (one call over the days that have records, one memo entry), so it covers
//     exactly the days Sales History and the P&L do, history limit included. Export: the existing PDF button (General > Margin), following the grouping and filter on screen; the total row is always the whole period.
//   - NO CHANGE TO RECORDS: no new fields, nothing uploaded, no database rules, and pos.html does not call marginBook, so the tills do not have to update together. Only index.html calls Sales.marginBook, so
//     sales.js and index.html must go out together (both are precached; the CACHE bump above refreshes them). scripts/till/ may keep its copy of sales.js: till_verify.js does not use marginBook.
//   - Tests: test_margin.js (the engine against the real sales.js and returns.js: hand-worked cases, real validated sale and refund records, 300 random histories against a brute-force calculation) and
//     test_margin_main.js (the screen, period rule, memo cache, escaping and export, cut out of index.html and run against the real sales.js).
// Previous: v0.3.72 (2026-11-15) — Till roadmap step 30: expiry dates and batches (sales.js + pos.html + index.html + sw.js; no database, rules, returns.js, shifts.js, till_verify.js or gate.js change).
//   - BATCHES. A batch is what one delivery brought in: the optional Batch / Lot No. (new on the Receive and Edit Receive forms; Scan Receive already had it) and the Expiry Date of its received row. Same batch no. + same date = one
//     batch; a row with neither is the undated batch (stock that does not expire, and every delivery before this version). Nothing is stored: Sales.expiryBook() (sales.js) replays the records the stock formula reads, in date/time
//     order, and gives every sale and issue to the batches FIRST-EXPIRED-FIRST-OUT, so the batches of an item always add up to its stockBook() balance (property-tested over 300 random histories).
//     A sale takes the batch that expires first and is still in date on the day of the sale (undated stock last); expired stock only when nothing in date is left. A return that goes back on the shelf goes to the batches its sale
//     line came from. An issue that names its batch (batchNo / expiryDate on the generalIssued row, as the write-off below does) comes off that batch only; an issue that names none goes FEFO, expired stock first.
//   - EXPIRED = the expiry date has arrived (today or earlier), the rule the dashboard alert always used, on the app's own date (today() = the UTC date, so a date turns expired at 02:00 Zambia time).
//   - TILL (pos.html). An item with expiry data shows "N expired - do not sell" and, within 30 days, "N expire <date>" on its tile; "in stock" and the low-stock test count only stock that is in date (the main app still shows the full
//     stock, expired included); an item that is all expired reads "All expired". Charge is refused while the cart would have to be sold from expired stock (a line in the cart says so); the way out is to remove it, write it off, or
//     correct a wrongly typed date. There is no manager-PIN override: a PIN approval would need a new audit event in shifts.js and database_rules.json, and the sale record has nowhere to say who allowed it. Items with no expiry data
//     behave exactly as before, and commodities keep their own per-batch stock (v0.3.36).
//   - MAIN APP (index.html). General > Actions > "Expiry" lists the batches that are expired or expire within 30 days (or all batches with stock), with what is LEFT of each, and a Write off button on expired ones: one ordinary
//     internal generalIssued row (reason Expired, no price, never a sale) that names its batch, with an audit entry. The dashboard EXPIRED STOCK / EXPIRING SOON warnings now come from the same batches: a batch is flagged only while
//     it still has stock on the shelf, and the quantity is what is left (before, a batch stayed flagged for ever, even when it had all been sold, and showed what was received).
//   - ALL TILLS MUST BE UPDATED TOGETHER: pos.html now calls Sales.expiryBook, so a phone that still has the old sales.js cannot load the till catalog. sales.js and pos.html are both precached; the CACHE bump above refreshes them.
//   - Tests: test_expiry.js (the engine, 631 checks, run against the real sales.js and returns.js), test_expiry_till.js (the catalog, tile and Charge block cut out of pos.html), test_expiry_main.js (the Expiry screen, write-off and
//     dashboard alerts cut out of index.html). scripts/till/ (nightly check) is unaffected: till_verify.js and the records it reads did not change.
// Previous: v0.3.71 (2026-11-15) — Till roadmap step 29, follow-ups: stock counts are measured against the stock AT THE TIME OF THE COUNT, a count can be applied to stock, and a stocktake is approved in one tap (index.html + sw.js; no database, rules, pos.html, sales.js or gate.js change).
//   - FALSE SURPLUS FIXED. The Stock Count tab's "Latest Count vs System" table and the dashboard STOCK VARIANCE warnings compared the latest count with TODAY'S stock (itemAvail), so after a big count everything that sold
//     afterwards looked like a surplus. Both now compare with the system stock at the moment of the count (Sales.stockBook until that minute: the same formula and 'until' as the count history and the Scan Stocktake review).
//     _countSysFor(rows) works the counts out in time order, one stock book alive at a time, and keeps the answers while the records stay the same. The tab shows "System Now" and "System at Count" side by side; the
//     history table uses the same helper (2,000 counts: about 0.6 s, was about 5.8 s with one stock book per count).
//   - APPLY COUNTS TO STOCK (Admin, never automatic; General > Stock Count > "Apply counts to stock", asks for the admin password). Until now a count only measured the gap, so a shortage stayed in the system for ever. Applying a
//     count writes ordinary rows that the ONE stock formula (and the till) already read, so the formula itself is unchanged: adjustment = counted - system stock at the moment of the count (sales since stay as they are).
//     A shortage is a generalIssued row (internal, reason "Stock count shortage", issueType 'count': no price, no customer, never a sale); a surplus is a generalInventory row received at no cost (purchasePrice 0, so purchases
//     and the weighted-average cost do not move). Rows are dated now, carry countAdj = the count's id and have the id 'cadj_<count id>', so the same count can never be applied twice (two phones, a double tap). The rows ARE the
//     record that a count was applied: deleting them makes the count applicable again. Only the latest approved count of an item is offered, only if no newer count waits for approval and no adjustment is dated after it.
//     The Stock Count tab marks applied counts ADJUSTED and the dashboard raises no variance warning for them. The new issue type is hidden in the Issue Item forms. One audit entry per application: "Stock Count Adjustment".
//   - APPROVE BY STOCKTAKE. In Pending Approvals the pending rows of one stocktake (same stId) are ONE card: short / over / exact against the system at count time, the ten largest gaps, and Approve all / Reject all
//     (Admin or Manager, with a confirmation; one audit entry per stocktake). Single counts and one-row stocktakes keep their own cards.
//   - Not changed: the commodity batch variance warnings (batchAvail / batchPhysical), which the stocktake does not write.
//   Test: test_stocktake_followups.js (the new code cut out of index.html, run against the real sales.js; 37 checks).
// Previous: v0.3.70 (2026-11-15) — Till roadmap step 29: stocktake by scanning (index.html + sw.js; no database, rules, pos.html, sales.js or gate.js change).
//   - General tab > Actions > "Scan Count" (Pro, pos_till; Admin and Manager, like Scan Receive). Scan with a USB/Bluetooth scanner or the phone camera: one scan = one more of that item, in the unit whose barcode it was
//     (a carton scan counts its whole factor). Codes are found exactly as in Scan Receive and the Till; an unknown or shared code counts nothing and is listed. Each line has - / + and a typed quantity.
//   - The count is blind: while scanning the screen shows only what was counted. Review then shows system against counted per item, biggest gaps first, with the gap valued at cost where the item has a cost price.
//     A counted total can be typed over in Review; an item with no barcode (or none on the shelf) is counted from "Not counted yet" (type the quantity, or 0), filtered by category or name.
//   - Save writes ONE normal generalStockCounts row per counted item (the same shape the Stock Count form writes: physicalCount in the BASE unit, itemName, itemId, date, time, notes; stampEntry, so a Manager's counts wait for
//     approval) plus an additive stId that groups the rows of one stocktake. So the Stock Count tab, its history, the approval list and the audit log need no change. One audit entry: "Scan Stocktake".
//   - Each row's date and time are the moment THAT item was last scanned or changed, not the moment Save was pressed. The Stock Count history already works the variance out against genStock(until that moment), so a sale made
//     after the shelf was counted is never a shortage or surplus. Review uses the same book (Sales.stockBook until), built once per distinct minute.
//   - Items not counted are NOT saved and keep their last count; nothing is ever set to 0 for the user. No stock is adjusted (like every stock count, this measures the gap; whether a count should adjust stock is an open decision).
//   - Draft: the count is kept on this phone (localStorage, per depot and login) after every change, like Scan Receive. Pause closes the screen and keeps it; Discard (after the question) removes it; Save removes it.
//   - Known, not changed here: the Stock Count tab's "Latest Count vs System" table and the dashboard STOCK VARIANCE warnings compare the latest count with TODAY'S stock (itemAvail), so after a big count every item that sells
//     afterwards shows a false surplus there. The history table (count-time stock) is right. A Manager's stocktake makes one pending approval per item (there is no approve-all).
//   Test: test_scan_stocktake.js (the stocktake code cut out of index.html, run against the real sales.js).
// Previous: v0.3.69 (2026-11-15) — Till roadmap step 28, follow-up 2: Scan Receive keeps an unsaved delivery, and takes damaged, expiry and batch per line (index.html + sw.js; no database, rules, pos.html, sales.js or gate.js change).
//   - Draft: the scanned list, supplier, date and payment are saved on this phone (localStorage, per depot and login) after every change and when the app goes to the background. Opening Scan Receive again
//     offers to continue it (OK) or delete it and start fresh (Cancel). Save and Cancel (after the discard question) remove it. Another phone or login never sees it.
//   - Per line, under "Damaged, expiry, batch": Damaged (in the scanned unit, at most the quantity), Expiry date, Batch / lot no. Same convention as the Receive form: received = everything that came, good + damaged = received,
//     condition good / damaged / all-damaged. So damaged units are still counted in stock until issued as "Damaged / spoiled" (step 24), exactly as with Receive. Expiry goes in the row's expiryDate (the Received tab already shows it);
//     the batch goes in a new additive batchNo and in the notes (BATCH ...). Edit and reports keep working: the data node is open, no rule is needed.
//   - Not covered yet (step 30): expiry alerts, selling the oldest batch first, stock by batch. Two batches of one item in a delivery: use "Another batch of this item" on the line (it opens a new line; scans go to the newest).
//   Test: test_scan_receive.js also covers the draft and the damaged / expiry / batch rows.
// Previous: v0.3.68 (2026-11-15) — Till roadmap step 28, follow-up: scanning a code no item has (index.html + sw.js; no database, rules, pos.html, sales.js or gate.js change).
//   - Scan Receive: a code no item has is no longer a dead end. It is listed under the scan box (several can wait) and an Admin can CREATE the item with that barcode (name, unit; it goes into the delivery at once;
//     the Price List still needs its selling price) or GIVE the barcode to an existing item that has none. Both follow Manage's rules (Admin only, plan item cap, no duplicate name) and are audit-logged. A Cashier,
//     Manager or Staff login is told to ask an admin. Skip drops a code. An item that already has a barcode is never changed here: a second code for it is a pack or carton in item details.
//   Test: test_scan_receive.js now also covers the unknown code, new item and give-barcode paths.
// Previous: v0.3.67 (2026-11-15) — Till roadmap step 28: receiving stock by scanning (index.html + sw.js; no database, rules, pos.html, sales.js or gate.js change).
//   - Receive tab > "Scan Receive" (Pro, pos_till): scan a delivery with a USB/Bluetooth scanner (scan box + Enter) or the phone camera (BarcodeDetector, same rules as the Till camera). One scan = +1 of that item,
//     in the unit whose barcode it was (item, pack or carton, step 26). EXACT barcode / SKU / unit barcode only: an unknown or shared code adds nothing and says so. Each line: qty and cost (per the scanned unit,
//     prefilled from the last cost). One supplier, date and payment status for the delivery. Save writes one normal generalInventory row per line in the BASE unit (qty x factor, cost / factor, notes "SCANNED..."),
//     updates the item's cost, and logs one "Scan Receive" audit entry. Staff entries follow the usual pending-approval rule. Stock, Received tab, reports and the Till are unchanged.
//   Test: test_scan_receive.js (the scan and save logic cut out of index.html). Previous version below.
// Previous: v0.3.66 (2026-11-15) — Till roadmap step 27: retail and wholesale price levels (sales.js + shifts.js + pos.html + index.html + database_rules.json + sw.js).
//   - Prices: an item keeps its RETAIL price (Price List, as before) and may have a WHOLESALE price per base unit, plus an optional "wholesale from" quantity. Set in the Price List (two new boxes
//     under each item and commodity) or in the item's details (which also has an optional wholesale price for each pack / carton; blank = wholesale price x contains). Saved as
//     DATA.inventoryPrices[name].wholesalePrice / wholesaleMin, DATA.commodities[i].wholesalePrice / wholesaleMin and item.units[].wprice. A wholesale price that is not BELOW the retail price
//     (of that unit) is never used, and the editors refuse it.
//   - Customers: Contacts > a customer > "Price level at the till" = Wholesale customer (contact.priceLevel = 'wholesale').
//   - Settings > Wholesale prices (Admin): OFF until switched on (depotInfo.wholesaleOn), and who may make a sale wholesale (depotInfo.wholesaleBy): 'pin' (default: a Cashier or Staff login needs a
//     manager PIN, an Admin or Manager login does not) or 'any'. Takes effect on each till after it syncs.
//   - Till: a line is sold at the wholesale price when (a) the sale is a wholesale sale, chosen on the new "Wholesale prices" row of the cart (a wholesale customer needs no PIN and the payment
//     screen then starts with, and keeps, that customer), or (b) the item's total in the basket reaches its "wholesale from" quantity (counted in base units over every line of the item, so a carton
//     plus singles add up; the tile says "Wholesale K8.00 from 12" and the cart says what to add). Items with no wholesale price stay retail. The cart shows "Wholesale price (retail K10.00)" under
//     the line; the receipt, the printed slip and the Sales History reprint say it too.
//   - Offers (step 25) and wholesale are never added together: each line takes whichever is CHEAPER for the customer, the wholesale price or the retail price with its offer (a tie goes to wholesale).
//     A manual discount (step 18) is a share of the value after wholesale prices and offers. A held basket, a resumed one or one restored after a reload does NOT keep its wholesale prices
//     (like a discount): choose them again. Wholesale prices switched off, or a customer who stops being wholesale, put an open sale back at retail with a message.
//   - Record: a wholesale line is simply sold at its lower price (line.price is what was charged), so totals, stock value, voids and refunds, Sales History and every report need NO change.
//     New, additive: line.level ('wholesale') + line.listPrice (the retail price per sold unit, higher than price) and, when the sale was chosen as a wholesale sale, the header's priceLevel
//     ('wholesale') + priceLevelBy (the person, the manager whose PIN approved it, or "Customer: <name>"). A line that reached its quantity by itself is tagged but has no header (nobody chose it).
//   - Audit log: a WHOLESALE entry for every sale chosen as wholesale (who allowed it, how much below retail). Nothing else in the audit log changed.
//   - database_rules.json MUST BE PUBLISHED BEFORE the phones update: sale lines accept level and listPrice, the sale accepts priceLevel and priceLevelBy. Until it is published a wholesale sale
//     (or a line that reached its quantity) is refused by the cloud and waits in the phone's outbox; retail sales upload as before. DATA prices and contacts need no rule (the data node is open).
//     ALL TILLS MUST BE UPDATED before wholesale prices are switched on: a phone still on the old till would sell at retail and could drop a wholesale sale it downloads.
//   - scripts/till/ (nightly check) needs the new sales.js and shifts.js beside till_verify.js, which itself is unchanged (it runs sales.js validate(), which now checks the wholesale fields).
//     New Node tests: test_levels.js (engine, record, ledger, audit log, nightly check), test_pos_levels.js (the till's cart code cut out of pos.html), test_price_levels_admin.js (item details and
//     Price List saves cut out of index.html).
//   - Not covered yet: the CSV import / export has no wholesale columns; there is no third price level; the Z report and the day close-out do not show a "wholesale given" figure (the sale's
//     lines and the audit log do); the quantity break counts one item at a time (no "any 12 drinks" across items); margin reports are step 31.
//   Files: sales.js + shifts.js + pos.html + index.html (Price List, item details, Contacts, Settings card, reprinted receipt, SW_VERSION) + database_rules.json + sw.js. returns.js, gate.js and till_verify.js are unchanged.
// Previous: v0.3.65 (2026-11-15) — Till roadmap step 26: multiple units, each / pack / carton (sales.js + returns.js + shifts.js + pos.html + index.html + database_rules.json + sw.js).
//   - Item details (Manage Inventory Items): OTHER UNITS, up to 3 per item: name, contains (how many of the item's base UNIT), barcode (optional), price (optional; blank = selling price x contains).
//     Saved as item.units. Stock, receiving, issuing, stock counts and the Price List stay in the BASE unit. A barcode, SKU or unit barcode must belong to ONE item and ONE unit: the editor,
//     the CSV import and the till all check it (the till refuses an ambiguous scan, as before).
//   - Till: scanning a pack or carton barcode adds that unit; a line that has other units shows a unit picker (changing it re-prices the line and merges it into a line already in that unit);
//     the same item in two units is two lines; the tile lists the other units; "only N in stock" counts base units across all of an item's lines; offers are worked on the base-unit
//     equivalent of a line; held baskets and restored carts re-price each line from its own unit (a unit the item no longer has keeps its stored price and is named in the notes).
//   - Record: a line sold in another unit carries factor + base (additive; absent for the base unit and for every sale before this version). qty, price, total, discount and offers stay in the
//     SOLD unit. Stock (stockBook, soldById), issuedRows (rows for the main app's reports: in BASE units, with soldQty / soldUnit / soldFactor for display) and returns (Returns.forStock)
//     use qty x factor. A refund or void line copies factor/base from its sale line and must be in the same unit. X and Z item lists keep one row per unit. Commodities are not sold in units.
//   - database_rules.json MUST BE PUBLISHED BEFORE the phones update: sale and return lines accept factor (up to 100000) and base. Until then a sale in a pack or carton is refused by the cloud and
//     waits in the outbox; sales in the base unit upload as before. ALL TILLS MUST BE UPDATED before units are used: a phone still on the old sales.js would count a carton as one unit of stock.
//   - scripts/till/ (nightly check) needs the new sales.js, returns.js and shifts.js beside till_verify.js, which itself is unchanged. New Node tests: test_units.js (record, stock, returns, reports,
//     nightly check), test_pos_units.js (the till's unit code cut out of pos.html), test_item_units.js (the editor's save cut out of index.html).
//   - Not covered yet: the CSV import / export has no unit columns; Price List edits the base price only (a unit's own price is set in item details); price tiers are step 27.
//   Files: sales.js + returns.js + shifts.js + pos.html + index.html (item details, SW_VERSION) + database_rules.json + sw.js. gate.js and till_verify.js are unchanged.
// Previous: v0.3.64 (2026-11-15) — Till roadmap step 25: promotions (sales.js + shifts.js + pos.html + index.html + database_rules.json + sw.js).
//   - Settings > Promotions (Admin): offers the till gives BY ITSELF, so the cashier does nothing. Four kinds: a percentage off; a special price per unit; N for a price
//     (3 for K20); buy N get M free. Each covers chosen items (stock items and commodities, by id) and/or whole categories, between two dates (both days included, the shop's
//     own calendar), on chosen weekdays; percentage and special price can need a minimum quantity. An offer can be switched off (kept) or deleted. They are DATA.promotions
//     and reach the tills with the normal sync, like prices.
//   - The rules are Sales.promoApply() in sales.js, whole ngwee, the same code the editor's checks (promoCheck) and the till run. Each LINE gets the ONE offer that saves the
//     customer most (the first listed wins a tie); offers do not stack on a line. A percentage is rounded down; a bundle or free units apply to whole bundles only and the rest of
//     the line is charged normally; a special price or bundle can never raise a price; no offer can take off more than the line is worth. An offer works on one item's line at
//     a time: there is no "any 3 drinks for K30" across different items (not built; a later step).
//   - The till: the offer shows under the line ("Offer: Sugar 3 for K20  -K8.00"), a short hint when one more unit would earn it ("Add 1 more: 3 for K20.00"), a green tag on the
//     item tile, an "Offers applied" row above the total, and on the receipt, the printed slip and the Z report. Offers are judged at the moment the cart is drawn and again when
//     Charge opens (an offer that ended in between redraws the cart and says so before any money is taken), so the payment screen and the saved sale always agree. A held or
//     restored basket gets today's offers, like today's prices.
//   - The record: an offer is a DISCOUNT WITH A NAME. line.discount stays "all the money off this line", so line.total, netPrice(), stock value, Sales History and the returns maths
//     need no change. New, additive: line.promoDiscount / promoId / promoName and the header's promoDiscount (their sum). A sale whose whole discount is offers has discountBy =
//     "Promotion", so a phone still on the old sales.js accepts it instead of dropping it. A refund of part of an offer line gives back that share of what was paid (the existing
//     rule for discounted lines); the last unit takes whatever is left, so a whole line always comes back to exactly what was paid.
//   - A cashier's discount (step 18) is now a share of the value AFTER the offers (the cashier limit means "5% of what the customer would otherwise pay"). Z reports and the day
//     close-out show "Offers applied" apart from "Discounts given"; the Audit log lists only a person's discount (an offer is not something anyone allowed).
//   - database_rules.json MUST BE PUBLISHED, and BEFORE the phones update: lines accept promoDiscount / promoId / promoName and the sale accepts promoDiscount (each checked, and no
//     bigger than the discount). Until it is published a sale with an offer is refused by the cloud and waits in the phone's outbox (nothing is lost, the till shows its usual
//     upload warning); sales without an offer upload as before. DATA.promotions needs no rule: the data node is open to the depot like the rest of DATA.
//   - till_verify.js is unchanged: it runs sales.js validate(), which now also checks that the promotion fields add up. New Node tests: test_promos.js (engine, record, returns,
//     reports, nightly check), test_pos_cart.js (the till's own cart code cut out of pos.html), test_promo_admin.js (the Settings code cut out of index.html).
//   Files: sales.js + shifts.js + pos.html + index.html (Promotions card, close-out, reprinted receipt, SW_VERSION) + database_rules.json + sw.js. gate.js and returns.js are unchanged.
// Previous: v0.3.63 (2026-11-14) — Till roadmap step 24: Issue Item is for internal issues only (index.html + sw.js; no database, rules, pos.html or gate.js change).
//   - Where the Till is available (not the Play Store build, and a plan with pos_till) SELLING happens only at the Till. Issue Item now records stock that leaves WITHOUT a sale:
//     transfer to another site, staff use, damaged / spoiled, expired, lost / stolen, sample / donation, other internal use. It asks for a reason (and "Sent to", "Taken by" or
//     "Purpose" for transfers, staff use and other), shows what is available, warns when more than that is issued, and has no price, customer, payment status or receipt. It takes
//     no receipt number, so the till's receipt numbers are not used up. Multi Issue does the same for its general-item lines; its commodity lines are unchanged.
//   - Such a row is a normal generalIssued row with internal:true, issueType and issueTo, sellingPrice 0 and nothing owed. It reduces stock like any issue (stock = received - issued -
//     sold + returns is unchanged) but, having no price, it never reaches Sales History, the shift totals, the debts list or revenue. Edit (single or bulk) keeps it that way: price,
//     customer and payment cannot be added to it. The audit log line says "Internal: <reason> ... (not a sale)".
//   - Issued tab: an All / Internal / Sales filter, a reason badge and the destination on internal rows, no receipt button for them. CSV export gains Reason and To / For at the end.
//   - Sales History's "+ New Sale" now opens the Till. Where the Till is not available the old Issue Item form (price, customer, payment, receipt) is unchanged, so nobody loses the
//     ability to record a sale. Earlier priced Issue Item rows are untouched and still list in Sales History.
//   - Commodity issues (Commodities tab) are not changed by this step.
// Previous: v0.3.62 (2026-11-14) — Till roadmap step 23, part 2: Sales History is built from the ledgers (index.html + sw.js; no database, rules, pos.html or gate.js change).
//   - The list is one row per till receipt and one per void/refund (read from the sales and returns ledgers), over the period chosen above the tab (Today / week / month / year / all /
//     date range; newest 150 shown), instead of today's item rows only. The main app's own Issue Item rows that carry a selling price are listed with them, as before; issues with no price are not.
//     Printing a row prints the whole basket or the void/refund slip. Commodity sales made at the till now show too (they did not before).
//   - Today's card and the period summary are worked out from the same records: revenue = sales less voids and refunds, "Paid" = money taken less money handed back (all methods), credit = still owed.
//   - The overlay is NOT retired: stock, reports, P&L, cash flow, customers, search and the AI context still read the till rows it puts in generalIssued / commodityIssued.
// Previous: v0.3.61 (2026-11-14) — Till roadmap step 23: the Sales tab becomes "Sales History" (index.html + sw.js; no database, rules, pos.html or gate.js change).
//   - The tab under Stock > Sales is now "📜 Sales History", the back-office view of sales: today's figures, the daily close-out, receipts and the period summary. A line at the top
//     says so and points to the Till for selling and for voids and refunds. Nothing in the view's figures, close-out or receipts changed.
//   - The Pro lock screen says "Sales History". The upgrade prompt now has its own label for it (it used to show the raw key daily_sales and name the Growth plan; it is a Pro feature).
//   - The feature key is still daily_sales, so no plan, licence or saved setting is affected.
// Previous: v0.3.60 (2026-11-14) — Till roadmap step 22: the management dashboard (index.html + sw.js; no database, rules, pos.html or gate.js change).
//   - Dashboard, Admin and Manager only, Pro plan like the till: a "Till Today" card with the day's net sales (sales less voids and refunds, summed from the same ledgers as
//     the daily close-out), what was taken by cash / MTN / Airtel / card / on credit, the shifts open right now with what each drawer should hold (a shift still open from an
//     earlier day is flagged), the shifts closed today with their cash variance, the low-stock list, and the Open Till button.
//   - While the card shows it replaces the Quick Actions "Open Till" button and the LOW STOCK lines of the alert block, so nothing is listed twice. Settings > Dashboard
//     Widgets > "Till Today" switches it off, and both come back.
//   - Shift records are re-read when they change (other tills' shifts arrive every minute) and also while offline, from this device, and the dashboard redraws when they do.
// Previous: v0.3.59 (2026-11-14) — Till roadmap step 21, follow-up: depot delete, wrong phone clocks, and a nightly check of till records (gate.js + pos.html + index.html + database_rules.json + sw.js).
//   - Delete account (Settings): refused while the company has any till record (sales, voids/refunds, shifts, shift closes, audit entries). Those are append-only, and
//     the database rules now also stop a depot admin from deleting a depot that holds any. The app asks the cloud BEFORE it frees any username or wipes anything, so a
//     refusal changes nothing and says why; no signal also stops it cleanly. Support (the super-admin uid, mdm-admin) can still close such an account.
//   - Wrong phone clock: the rules refuse a sale, void/refund, shift open or shift close stamped more than 2 days ahead of the server (the audit log is exempt: it must
//     always be able to record). So the till measures its clock against the server (a tiny write to depots/<depot>/clock/<till>, every 5 minutes online, on coming back
//     online and before a shift is opened) and, while the phone is 6 hours or more out (the AM/PM mistake, a wrong day), pauses sales, voids/refunds and shift open/close
//     with a message to fix the date and time. A measurement counts for 10 minutes by the phone's own clock, so fixing the clock frees the till at once; no signal, or rules
//     not published yet, means "unknown", never "wrong". A phone that says it is before November 2026 is always refused. gate.js: restCloud.put + clockNote / clockDue / clockProblem.
//   - database_rules.json MUST BE PUBLISHED (and BEFORE the phones update): new depots/<depot>/clock/<till code>; `at` capped at server time + 2 days on sales, returns,
//     shifts and shiftCloses; the depot-delete rule. Until it is published nothing breaks: the clock check just cannot measure (so never blocks).
//   - Not fixable in the rules, so checked afterwards: line totals, lineCount, qtyTotal and payment sums (rules cannot add up a list). till_verify.js (Node, not shipped to
//     phones) re-checks every till record and the sums against sales / returns / shifts, for the nightly backup job.
//   Files: gate.js + pos.html + index.html (account delete check, SW_VERSION) + database_rules.json + sw.js. sales.js, returns.js and shifts.js are unchanged.
// Previous: v0.3.58 (2026-11-14) — Till roadmap step 20: audit-log entries for the till (shifts.js + pos.html + index.html + database_rules.json + sw.js).
//   - Settings > Audit Log (Admin) now shows what happens at the till, with who, when and who allowed it. It covers steps 14-19:
//       Shift opened; shift closed (expected, counted, SHORT / OVER, FORCED when someone else closed it, the note)
//       Discount given (amount, %, who allowed it, manager PIN or own limit, reason)
//       Void and refund (the sale, reason, who allowed it, money paid back)
//       X report taken (a manager's look at someone else's shift says so), Z report shown or reprinted (COPY), saved day Z printed (main app)
//       Manager PIN let a cashier leave the till (who allowed it); wrong manager PIN (what it was for, tries left); PIN pad locked
//       A login added or removed in Settings > Users (a Cashier included; the password is never logged)
//     Already logged and unchanged: Manager PIN set / removed, Till exit PIN switch, Till discount settings, Daily Close Out.
//   - HOW. The till cannot call logAuditEvent(): that writes into DATA, one blob where the last write wins, which is exactly why sales, shifts and returns live
//     outside it. So the till's lines reach the Audit log the same way its sales do:
//       1. Events that ALREADY have a record are not written twice. Shifts.auditEntries() reads them from the record itself (shifts/, shiftCloses/, the discount
//          fields on sales/, returns/), so the log cannot disagree with the ledger and a line cannot go missing.
//       2. Events with NO record of their own (X report, Z shown / reprinted, PIN let someone leave, wrong PIN, pad locked) are written by the till as new
//          append-only records, tillAudit/{id} (id K7F2-A<time><3 random>, create-only), through shifts.js log(). Same IndexedDB store, outbox and download as
//          the shifts (no schema change). The PIN typed is never stored.
//       3. index.html _auditAll() = DATA.auditLog + Shifts.auditEntries(...), read fresh each time. The viewer (newest 100) and the PDF export both use it. Nothing
//          is copied into DATA.auditLog, so two phones cannot double a line and the 2000-line cap cannot trim till lines. Main-app events still use logAuditEvent.
//     Best effort: a failed till log is a console warning only; it never stops a sale, a PIN or a report. A till that has not claimed its code logs nothing.
//   - database_rules.json MUST BE PUBLISHED: new depots/<depot>/tillAudit node (create-only, only for a registered till, event limited to the five above, every field
//     checked). Until it is published the till still sells, opens and closes shifts and uploads them as before; only the audit records wait in the outbox on the
//     phone (nothing is lost) and the till's shift-upload warning shows. Publish it BEFORE the phones update.
//   - Not logged: a discount put on a cart that was never sold; each press of Print (the report is logged when it is shown); idle auto-logout (nobody is there);
//     password resets. Till lines are readable by every signed-in phone of the depot, like shifts and sales; closing that is step 21.
//   - shifts.js: new 'audit' record kind (auditRecord / validateAudit), create(env).log(), auditEntries(); push sends audit records last, pull fetches them last.
//     shiftsOf() and openShiftOf() ignore them, so shifts behave exactly as before. sales.js, returns.js and gate.js are unchanged; shifts.js was already precached.
//   Files: shifts.js + pos.html + index.html (Audit Log viewer and export, user add / remove, day Z print, SW_VERSION) + database_rules.json + sw.js.
// Previous: v0.3.57 (2026-11-14) — Built-in printer, no more limits: pictures (logo, tables, ID cards, books), long jobs in parts, RawBT install link (index.html, pos.html, sw.js).
//   - Print style (Settings > Printer): Auto = receipts as text, documents as pictures; Plain text; Pictures for everything. A picture is the page drawn in black and white and sent as
//     ESC/POS raster, so the logo, tables and layout print. Wide tables fit best on 80 mm paper or at Normal size. If drawing fails the job prints as text instead.
//   - Staff ID cards and book/spreadsheet prints now go to the built-in printer too (ID cards as a white card with a black border to save ink).
//   - Long jobs are no longer sent to the browser print dialog: they are cut into parts of at most 200 KB; part 1 goes at once, a bar asks for a tap before each next part
//     (Chrome only allows the hand-off right after a tap). Auto prints a document that needs more than 3 picture parts as compact text to save paper.
//   - If RawBT is not installed, the hand-off now opens its Play Store page instead of doing nothing (index.html and the Till in pos.html). Settings > Printer has a Get RawBT link.
//   - pos.html: the Till's Printer dialog no longer wipes the Print style setting when it saves. No database or rules change.
// Previous: v0.3.56 (2026-11-14) — Built-in printer switch in Settings; Print buttons print straight to the terminal's printer (index.html, sw.js).
//   - Settings > Printer (Admin and Staff): Built-in printer tick, Thermal paper (Auto / 58 mm / 80 mm), Print size, Test print. Per device; same localStorage key as the
//     Till's Printer button (mdm_till_printer), so one switch covers both the Till and the main app.
//   - ON: receipts, void/refund slips, Z reports and the subscription receipt print by RawBT with no print screen. Payslips, reports and other documents keep their
//     screen, but its Print button prints straight to the printer. Needs the free RawBT app. OFF: the browser print dialog, as before. No database or rules change.
// Previous: v0.3.55 (2026-11-14) — Till roadmap step 19: voids and refunds as new records linked to the sale (returns.js NEW + sales.js + shifts.js + pos.html + index.html + database_rules.json + sw.js).
//   - returns.js (new, loaded by pos.html and index.html): returns/{returnId}, create-only and append-only like sales and shifts. A VOID takes back the whole sale in the shift it
//     was taken in; a REFUND takes back some or all lines at any time. Each has a reason, the manager who allowed it, and points at the sale. The customer's unpaid balance is
//     cleared first; only the rest is money handed back. A damaged return is not put back in stock. Numbers come from the till's receipt counter (K7F2-R000125).
//   - Till: new Returns button (find the sale, choose lines or void, reason, how the money goes back, manager PIN for anyone but Admin/Manager, slip prints in the browser or by RawBT).
//     Cash handed back comes off the drawer: expected cash, close shift, X and Z reports and My sales all show it.
//   - Main app: stock, reports, customer balances and the daily close-out count the returns (a return is booked on the day it is made, so a closed day never changes).
//   - database_rules.json: new returns node (create-only, only once its sale is in the cloud). Publish it BEFORE using Returns on more than one phone.
//   - sw.js: returns.js is precached. The offline rule for scripts now also covers shifts.js and returns.js (it only listed gate.js and sales.js, so shifts.js was not served from the cache offline).
// Previous: v0.3.54 (2026-11-13) — Printer text size: Font A forced, new Text size setting (default Large) (pos.html, index.html SW_VERSION only, sw.js).
// Previous: v0.3.53 (2026-11-13) — Printer paper width: new Auto option (default; 58 mm on a handheld), Test print adds a width ruler (pos.html, index.html SW_VERSION only, sw.js).
// Previous: v0.3.52 (2026-11-13) — Till auto-print on built-in thermal printers (pos.html, index.html SW_VERSION only, sw.js).
//   - Till header > Printer: choose Browser print dialog (as before) or RawBT thermal (ESC/POS, 58/80 mm), switch on auto-print after each sale, Test print.
//   - Settings are per device (localStorage mdm_till_printer). No database or rules change.
// Previous: v0.3.48 (2026-11-13) — Settings fix (index.html, sw.js).
//   - The Till discounts card (step 18) was hidden from every Settings category, so the Admin could never switch discounts on
//     and the till never offered them. It now shows under Settings > Account & Security, after Manager PIN. No data or rules change.
// Previous: v0.3.47 (2026-11-12) — Email-based accounts, editable company location (index.html, sw.js, database_rules.json, mdm-admin.html, mdm-mail.gs).
//   - Signup no longer collects a contact name or phone. Email is required and is the only contact detail (licenseContacts/<id>/contactEmail).
//   - Email is verified with a 6-digit code sent from support@nexlitedigitalsolutionslimited.digital by the Google Apps Script mailer (mdm-mail.gs).
//     Existing accounts and staff logins are prompted after sign-in until verified. Admin password recovery now uses an emailed code.
//   - Subscription applications carry the email (replaces phone). The admin app can reject an application and emails approvals and rejections.
//   - Company name stays permanent (it is the identity). Country, province and district are editable in Settings and never touch licenses/<id>.
//   - Needs: deploy mdm-mail.gs and paste its URL into MAIL_ENDPOINT (index.html and mdm-admin.html); PUBLISH the new database_rules.json.
// Previous: v0.3.46 (2026-11-12) — Landing page refresh (index.html + sw.js).
//   - New landing page: top bar with Sign in, hero with a sample till receipt, then the Till (scan, cash / MTN Money / Airtel Money / card,
//     credit sales, hold and resume, numbered receipts, discount limits), shifts and cash-up, and the rest of the app's features, plan cards
//     built from TIER_META / _TIER_BULLETS (renderLandingPricing), a closing sign-up call to action and the support links.
//   - The 30-day trial wording is no longer shown on the landing page or the Plans & Pricing page. Trial logic, the signup note and the
//     in-app trial banners are unchanged. The Text size control moved to the landing page footer.
//   - No new files, no database_rules.json change. gate.js, sales.js, shifts.js and pos.html are unchanged.
// Previous: v0.3.45 (2026-11-12) — Till roadmap step 18: discounts with caps or a manager PIN (sales.js + shifts.js + pos.html + index.html + database_rules.json).
//   - The Admin switches discounts on in Settings -> Till discounts (OFF by default, so nothing changes until then): "a cashier may give up to X% of the
//     basket" (default 5) and "nobody may give more than Y%, even with a PIN" (default 20, never above 90). depotInfo.discountOn / discountCapPct / discountMaxPct.
//   - The till shows a Discount button in the cart (only when switched on). One discount for the whole basket, as a percentage or an amount, with an optional
//     reason. A Cashier or Staff login gives up to X% alone; more, up to Y%, asks for a manager PIN on the same PIN pad as step 15 and the approver is saved;
//     an Admin or Manager login gives up to Y% alone; nobody gives more than Y%. With no PIN set, a cashier simply cannot go above X%.
//   - The discount is shared over the lines in whole ngwee and saved on the sale: each line's `discount`, the sale's `discount`, `discountBy` (who allowed it)
//     and `discountReason`. line.total is the amount AFTER the discount, so the sale total, the Z report's item list, stock value and the main app's revenue
//     (issued x selling price: the overlay now carries the price actually charged) all stay right. A sale with no discount has none of these fields.
//   - A percentage is rounded down per line, so a limit of 5% can never be tipped over by rounding. A PIN approves a percentage: adding items keeps it;
//     removing items so the same amount becomes a bigger share takes it off, with a message. It is checked again when Charge opens and when payment
//     completes, and a policy switched off or tightened takes it off too. It is NOT kept when a sale is held, resumed or restored after a reload (it must be
//     allowed again), and the till says so.
//   - Receipt (till preview and print, and Sales History print): lines at their value before the discount, then Subtotal, Discount, TOTAL. The reason is
//     not printed. X and Z reports, the day close-out and the saved day Z show "Discounts given", already inside the total.
//   - sales.js: validate() checks the line discounts, that the sale's discount equals their sum, and that a discount names who allowed it; Sales.discountPolicy /
//     discountSplit / discountJudge are the rules, shared by the till and the tests. shifts.js: report() and dayReport() add discountGiven / discountCount.
//   - database_rules.json MUST BE PUBLISHED: sales/{id} gains optional discount, discountReason, discountBy, and lines/{i} an optional discount (never more
//     than price x qty). Until it is published, only a sale WITH a discount is refused by the cloud (it stays on the phone and is retried); every other sale uploads as before.
//   - Soft control, like step 15: the PIN is checked on the phone against the PIN records that travel with the depot data. It stops the casual over-discount,
//     not a determined attacker with the phone; the cloud rules cannot know the cap (it is a setting), they only keep the numbers consistent.
//   - Not in this step: a discount on one line (the record already allows it), the discount in the Audit log (step 20), a discount on a void/refund (step 19).
//   Files: sales.js + shifts.js + pos.html + index.html (Settings, receipt, close-out, SW_VERSION) + database_rules.json + sw.js. gate.js is unchanged.
// Previous: v0.3.44 (2026-11-12) — Till roadmap step 17 follow-up: a shift that crosses UTC midnight is counted on ONE day (shifts.js + index.html).
//   - FIX: a shift that ran across UTC midnight (02:00 Zambia time) was listed on both days' close-outs, so its variance and its count were added into both days,
//     while its sales sit on the days they were taken. Now a shift is listed on exactly one day: the day it was CLOSED (when its drawer was counted), or the day it
//     was OPENED while it is still open. Sales are not touched: each stays on the date it was taken, so the day's sales and cash figures are unchanged.
//   - A shift opened on an earlier day and closed today shows "(opened <date>)" in the close-out and on the printed day Z, with one line saying it is counted in full
//     on the day it was closed (its count includes cash taken on the earlier day). The saved close-out keeps openedDate for each shift; older records have none and print as before.
//   - A shift left open from an earlier day stays the amber "Also still open from an earlier day" warning. It is no longer also a "NOT CLOSED" row in the record of a later day.
//   - shifts.js: dayReport() only. No new records: database_rules.json, gate.js, sales.js and pos.html are unchanged.
//   - Still not in: cash paid out of the drawer (19), manager PIN for reprints / discounts (18), reprinting the Z of any earlier shift and the shift list for managers (22/23).
//   Files: shifts.js + index.html (close-out, SW_VERSION) + sw.js.
// Previous: v0.3.43 (2026-11-12) — Till roadmap step 17: X and Z reports, and the daily close-out becomes the day's Z (shifts.js + pos.html + index.html).
//   - X report: a printable reading of the shift that is open now (sales, items, money by method, float, cash that should be in the drawer). Records nothing,
//     changes nothing, any number of times. Button "X report (does not close)" in the shift sheet; an admin or manager can also take it for another cashier's open shift.
//   - Z report: the final figures of a closed shift, taken from its shiftCloses record (so it equals what was counted), plus the item list from the ledger.
//     "Z report (print)" appears right after Close shift; "Reprint last Z report" (marked COPY) is on the Open shift screen. The shift id is its number: no Z counter exists.
//     If the phone does not hold every sale of that shift, the totals still print and the item list is left out rather than shown wrong.
//   - Both use the receipt paper (logo, brand colour, print rules, Save as PDF). pos.html: paperTop() is now shared by receipt and reports.
//   - shifts.js: report('X'|'Z'), dayReport(date, ...), itemsOf(): pure functions, nothing stored. No new records, so database_rules.json is unchanged.
//   - Main app (index.html loads shifts.js and reads the shift records, synced every minute with the sales): the daily close-out is now the DAY'S Z.
//     FIX: expected cash used to treat every paid till sale as cash, so MTN, Airtel and card sales inflated it. It is now the cash payment lines of the till's sales
//     + the main app's own cash issues. Mobile money, card and credit are shown separately. Commodity sales at the till are now included (they were not before).
//     The day cannot be closed while a shift opened that day is still open ("Close out anyway" for a shift that cannot be closed; the record lists those shifts).
//     An empty cash-counted box is refused (it used to save as 0). The saved record keeps the old fields and adds zRef ('Z-' + date), till figures and one line per shift.
//     "Print Z report" on the closed card prints the saved day Z (shifts, difference per shift, items). Audit line extended.
//   - Not in this step: cash paid out of the drawer (19), manager PIN for reprints / discounts (18), shift list for managers (22/23).
//     Known limit: a shift that spans UTC midnight (02:00 Zambia time) is listed on both days but its sales land on the day they were taken.
//   Files: shifts.js + pos.html + index.html (loads shifts.js, close-out, SW_VERSION) + sw.js. gate.js, sales.js and database_rules.json are unchanged.
// Previous: v0.3.42 (2026-11-11) — Till roadmap step 16: open and close shifts, expected versus counted cash (shifts.js NEW + pos.html + sales.js + database_rules.json).
//   - A shift is one cashier on one till: Open shift (the float, the cash already in the drawer) -> sales -> Close shift (the cash counted).
//     Header button + pill: "Open shift" / "Close shift". A till with no shift opens straight onto the Open shift sheet (Close = browse only).
//   - A real sale needs an open shift of the person logged in; every sale record now carries shiftId (sales.js, optional: older sales have none).
//     A practice sale needs no shift. Checked again, under a lock, at the moment of saving, so a second tab cannot sell into a shift just closed.
//   - Close: shows sales, total, money by method, credit, float, cash sales and "cash that should be in the drawer" (= float + CASH taken on that
//     shift's sales, change already out). The cashier types the count; short / over / balanced shows live; optional reason. The close record keeps
//     expected, counted, variance, totals, first/last receipt. Final: no edit, no reopen.
//   - One shift per till at a time. A shift left open (idle logout, phone put away) is still there at next login: the same cashier carries on; anyone
//     else is blocked and an admin or manager can close it for them (record says forced:true, closedBy). The float for the next shift starts at the last one.
//   - Step 15 now uses the real thing: shiftOpen() = the person logged in has an open shift on this till and is not an admin/manager. Closing the shift is
//     the way out that needs no PIN. A cashier blocked by someone else's shift is not asked for a PIN.
//   - Records: shifts/{id} (open) and shiftCloses/{id} (close), create-only, uploaded and downloaded like sales (IndexedDB "mdm_shifts", own database).
//     Rules: database_rules.json needs publishing, it adds shifts, shiftCloses and the optional shiftId on sales. Until published, shift and sale uploads
//     that carry a shiftId are refused by the cloud, retry and wait in the outbox; nothing is lost on the phone.
//   - Also: the stale cart hint "Sales are not saved yet" is gone (it now shows the shift hint). shifts.js is in the precache list.
//   - Not in this step: X/Z reports and print (17), cash refunds / pay-outs in the drawer (19, shifts.js already takes them as `out`), audit-log lines (20),
//     the management view of shifts in the main app (22/23). Known limit: a till whose browser storage was cleared gets a new identity and an open shift
//     of the old one stays open in the records (an admin closes it with step 22).
//   Files: shifts.js (new) + pos.html + sales.js + database_rules.json + sw.js + index.html (SW_VERSION only). gate.js is unchanged.
// Previous: v0.3.41 (2026-11-11) — Till roadmap step 15: manager PIN to leave the till (gate.js + index.html + pos.html).
//   - An admin or manager sets a 4-6 digit PIN in Settings → Account & Security → Manager PIN (asks for their account password;
//     stored as a salted PBKDF2 record on their user, u.pin; never in clear). Changes are audit-logged (the PIN itself never is).
//   - The Admin switches on "Require a manager PIN to leave the till while a shift is open" (depotInfo.tillExitPin, off by default,
//     can only be switched on once someone holds a PIN). Then a Cashier or Staff login in the till gets a PIN pad when it taps Log out
//     or Main app; an admin or manager PIN unlocks it. Cancel stays in the till. Admin and Manager logins are never asked.
//   - 5 wrong PINs in a row lock the pad for 1 minute on that phone (counter in localStorage 'mdm_pin_lock').
//   - NOT asked: idle auto-logout, a logout made in the main app, and the "till unavailable" cards (no till, so no shift).
//   - Shifts do not exist yet (step 16). shiftOpen() in pos.html is the one place that decides "a shift is open"; until step 16 it
//     means "a Cashier or Staff login is signed in at the till". Step 16 swaps in the real shift state.
//   - gate.js gained the shared PIN rules (Gate.pinRecord / pinCheck / pinFindApprover / pinRequired / pinLockState / pinFailed).
//   - Takes effect on a till phone once it has synced the depot data (the PIN record and the switch travel in it). Before that sync
//     that phone does not ask. Soft control: the record travels with the depot data, so it stops the casual walk-away, not a
//     determined attacker with the phone; the real lock-down of data access is step 21.
//   - Known gap until step 16: a cashier who opens index.html directly (not via the till) can use its Log out card without a PIN.
//   Files: gate.js + index.html + pos.html + sw.js. sales.js and database_rules.json are unchanged.
// Previous: v0.3.40 (2026-11-11) — Till roadmap step 14: the Cashier login (index.html + pos.html).
//   A new role, "Cashier", for the person who only sells. Admin adds it in Settings → Users → Add User (role "Cashier (till only)").
//   - Signs in and goes straight to the Till (pos.html). Waits for the licence check first, so a suspended / pending / grace account
//     shows a card with the reason instead of a till that will not open. If the till refuses to open and sends the cashier back, the
//     card stays (no redirect loop): the guard is a 15-second mark in sessionStorage.
//   - Sees nothing else: bottom nav, menu, global search and the Assistant are hidden, every tab is forced back to the home card
//     (showTab and render), and the home card has only Open Till, Log out and Change password. The till's "Main app" button is
//     hidden for a cashier and replaced by "My sales": today's sales by this cashier (count, total, collected per payment method,
//     still owed on credit, each sale), from the ledger on the phone, read-only. A full shift report (float, counted cash) is
//     roadmap steps 16-17.
//   - The till's own hints that say "in the main app" (no items yet, no price, no customers, till not set up) tell a cashier to ask the
//     admin / log in online instead, since a cashier has no main app.
//   - changePw() now writes "Password updated" to the live element: updateData() re-renders the page hosting the card (the cashier's
//     home card), so the message used to land on a detached node and the cashier saw no confirmation. Same fix helps any role.
//   - Exempt from the pending-approval rule: stampEntry() stamps a cashier's entries 'approved'. Till sales were already approved
//     (the ledger overlay in sales.js), and a cashier has no entry forms in the main app, so nothing changes for sales; the rule is
//     now explicit.
//   - The cashier's cloud access is the least-privilege 'staff' entry in authorizedUids (_grantAuthorizedUid), which the existing
//     database rules already allow to create sales. No rules change.
//   - Per-role auto-logout (Settings) now lists Cashier. Not offered in the Play version (the till is off there).
//   Limit: this scopes what the cashier SEES. Like the Staff role, the phone still holds the depot's data and the cloud session can
//   reach the whole depot node; closing that is roadmap step 21 (database rules), not this step.
//   Files: index.html + pos.html + sw.js. gate.js, sales.js and database_rules.json are unchanged.
// Previous: v0.3.39 (2026-11-11) — Till step 13: the till's printed receipt (pos.html).
//   The till already showed one multi-line branded receipt per basket (logo or initials, brand colour, shop name, district, phone,
//   receipt number, date, cashier, every line, total, payments, change, balance, customer). This version fixes what stopped it
//   being a receipt you can hand over:
//   - BUG: the receipt of a SAVED sale was stamped "PREVIEW — NOT A SALE". finalizeSale passes an empty tag for a real sale, and
//     showReceipt() turned '' into the preview text (tag||'PREVIEW...'). Now only a missing tag means preview; '' means no stamp.
//   - A fully paid sale now carries a "PAID IN FULL" tag in the brand colour, next to the existing ON CREDIT / PART PAID tags (not
//     on practice sales).
//   - Print layout: @page margin 0, so Chrome adds no URL/date header and footer; the receipt carries its own padding. Compact
//     spacing so a 9-line basket fits one page. Each item (name + price line) is kept whole across page breaks and the totals,
//     payments and footer block is kept together, so a long basket breaks between items and the footer is never left alone.
//     Checked at Letter and at an 80 mm roll width.
//   - Brand colour: a light brand colour (yellow, pale tones) now gets dark initials and a dark TOTAL instead of white-on-yellow
//     and yellow-on-white. Dark colours, the default green included, print exactly as before.
//   - Print sets the page title to "Receipt <number>" while the print dialog is open, so "Save as PDF" proposes that file name; it
//     is restored after printing.
//   Files: pos.html + index.html (SW_VERSION only) + sw.js. gate.js, sales.js and database_rules.json are unchanged.
// Previous: v0.3.38 (2026-11-11) — Till step 12: camera barcode scanning (pos.html).
//   New camera button in the Sell screen's scan bar. It opens a full-screen scanner that uses the browser's own BarcodeDetector
//   (Chrome / Samsung Internet on Android, installed PWA included; no library, works offline). The button is only shown where
//   BarcodeDetector exists; Safari and desktop Chrome on Windows/Linux keep the scan box (USB/Bluetooth scanner or typing).
//   The camera stays open for a whole basket. Each read goes through the new resolveCode() (pos.html), which the scan box now
//   uses too, so a camera read follows the same exact barcode/SKU rule: no name search, two items with one code add nothing.
//   Only a barcode near the middle of the picture counts; two different ones in view add nothing. A code that stays in view is
//   added once. EAN/UPC/Code 128 are accepted on one frame, other formats must be read twice in a row. A 13-digit read that
//   starts with 0 also matches the same product stored as a 12-digit UPC-A, and the other way round (camera only). Beep and
//   vibration on each read, torch button where the camera has one, stock warning in the scanner. Camera is switched off on Done,
//   Escape, app to background and page hide. Scans count as activity for the idle logout.
//   Files: pos.html + index.html (SW_VERSION only) + sw.js. gate.js, sales.js and database_rules.json are unchanged.
// Previous: v0.3.37 (2026-11-11) — Till scanning is exact (pos.html) + version constants brought back in step.
//   Scan box, on Enter: a code must equal a barcode or SKU exactly (case-insensitive). Before, a code with no exact match fell
//   back to the typing search and was added if exactly one item was left, so a short or unknown scanned code that sat inside
//   another item's barcode, SKU or name could add the wrong item. Now a value with no space and a digit in it (4006381333931,
//   SB-001) counts as a code and never falls back; only words (sugar, coke 500) keep the one-item-left shortcut. If two items
//   share a code nothing is added and the message names them (the item form and the CSV import already refuse a shared code,
//   so this only guards data that got in another way). Also: v0.3.36 raised CACHE here but left index.html's SW_VERSION at
//   v0.3.35, which drives the Median ?_mv= reload, the shell cache name and the version shown in Settings. Both are v0.3.37 now;
//   always bump them together. Files: pos.html + index.html (SW_VERSION only) + sw.js.
// Previous: v0.3.36 (2026-11-11) — Commodity stock per BATCH now follows the same formula.
//   Till sales of a commodity name no batch, so until now they sat in a pseudo batch "TILL SALES" (negative stock) while the
//   real batches never went down. Sales.batchBook (sales.js, NEW) splits the one formula by batch: batch stock = received -
//   issued - sold, with each sale line allocated to the batches FIFO (oldest stock first) by replaying the records in date/time
//   order. Nothing is stored, so a backdated receive simply re-works the allocation; the batches always add up to the commodity
//   total the till shows (stockBook). A sale bigger than the stock at that moment shows as a negative on the batch it last took
//   from, and the TILL SALES row only appears if a sale happened before any stock was recorded. index.html now uses it for
//   batchAvail (variance warnings, Issue and stock-count forms), the Available column on the Received/Issued tables (a till-sale
//   row shows the commodity's total after the sale), the Variance screen (including stock "at the count date"), the Batch Summary
//   (sold quantity and sales money now land on the real batch, so batch profit is no longer overstated) and the batch list used
//   for work-log stock tags. Period reports are flows over a date range, not balances: they already include till sales and are
//   unchanged. Files: sales.js + index.html + sw.js (pos.html, gate.js and database_rules.json are unchanged).
// Previous: v0.3.35 (2026-11-11) — Till step 10, ONE stock formula: stock = received - issued - sold + returns.
//   Sales.stockBook (sales.js) is now the only place stock is worked out; the till (pos.html) and the main app (index.html,
//   genStock) both call it, so they can never disagree. Nothing is stored: every figure is summed from records. Only approved
//   entries count (pending and rejected never do), sold is read straight from the ledger (the in-memory _sale overlay rows are
//   skipped, so a till sale is never counted twice), and returns are a real term, fed by void/refund records from roadmap step 19
//   (none exist yet). Replaced the copies of the old rec-minus-iss sum behind the dashboard stock cards and alerts, the Inventory
//   cards and stock value, the Issue form's "Available", stock counts (stock AT the count) and the inventory CSV. Those copies
//   disagreed: some counted pending entries, some did not. Now one rule, so one item shows one number everywhere.
//   Period reports (received/issued over a date range) are flows, not balances, and are unchanged. Commodity per-batch stock is
//   unchanged; the till totals a commodity with the same formula.
//   Files: sales.js + pos.html + index.html + sw.js (gate.js and database_rules.json are unchanged since v0.3.34).
// Previous: v0.3.34 (2026-11-11) — Till step 9, the append-only sales ledger (sales.js NEW + pos.html + index.html +
//   gate.js + database rules). Completing a sale in the till now RECORDS it: one record, sales/{saleId} (saleId = the receipt
//   number), written once and never changed. It is saved on the phone first (IndexedDB "mdm_sales", with its "to upload"
//   mark, in one transaction) and only then does the cart empty and the receipt show; if that fails nothing is recorded and
//   the cart stays. It is then uploaded to depots/<depot>/sales/<saleId> (create-only in the rules, retried until it works,
//   a double upload is harmless) and the other tills' sales are downloaded. Sales are NOT written into the DATA blob, so two
//   tills selling at once cannot overwrite each other. Stock on the till = received - issued - sold (by item id). The main
//   app overlays the ledger on DATA in memory (rows flagged _sale, never saved or synced as part of DATA) so stock, reports,
//   close-out and customer balances include till sales; those rows cannot be edited or deleted. Sales are in JSON backups.
//   Until roadmap step 10 replaces the overlay with stock = received - sold + returns. NOT YET: receiving payment on a till
//   credit sale (it needs its own append-only record). PUBLISH database_rules.json (new sales node) BEFORE using the till.
//   sw.js: sales.js is precached and served network-first, exactly like gate.js.
// Previous: v0.3.33 (2026-11-10) — Till step 8, receipt numbers (gate.js + pos.html + index.html + database rules).
//   A sale gets a number like K7F2-000123 = this device's till code + its own counter. The code is CLAIMED IN THE CLOUD
//   (depots/<depot>/tills/<code>, create-only in the rules), so two tills can never share one: no more 1-in-thousands
//   chance. The claim needs the network once per device; until then the till will not number a sale (a practice sale,
//   which uses no number and is not counted, still works) and the main app keeps the old #XXXXXX. The counter is saved
//   and read back before the number is handed out, under a cross-tab lock, so tabs share it and a crash leaves a gap but
//   never a repeat; a wiped or damaged record gets a NEW code. The main app's single and multi issue now use the same
//   series and print it. PUBLISH database_rules.json (new tills node) BEFORE using the till. sw.js logic unchanged.
// Previous: v0.3.32 (2026-11-10) — Till: Firebase start-up fix + live-cart autosave (pos.html).
//   (1) The till's inline script ran before its `defer`red Firebase SDK tags, so firebase.initializeApp never ran:
//   App Check was never activated and POS.idToken() always returned null. Init now waits for DOMContentLoaded (the page
//   still paints without waiting for the SDK; with no SDK it carries on without a cloud session, as before).
//   (2) The open cart is autosaved on the device after every change and restored after a reload; a cart left by a tab
//   that died (browser killed, phone restarted) is moved into Held, marked "recovered", by the next till tab that opens.
//   A tab still in use is never robbed of its cart (Web Locks tell live tabs from dead ones). Not a sale: nothing is
//   recorded and no stock moves. pos.html change + version bump; no sw.js logic changes.
// Previous: v0.3.31 (2026-11-10) — Till step 7, held sales: "Hold sale" in the cart parks the basket, and a
//   "Held (n)" button under the search box lists the parked baskets and resumes or discards one. Baskets are kept on
//   the device (localStorage, one list per depot), so they survive a reload, a logout or an offline spell and are
//   shared by every till tab. Resuming parks any cart that is open, then re-reads the prices from the Price List.
//   A cart left open at logout / idle timeout is parked instead of lost. A held basket is not a sale: nothing is
//   recorded and no stock moves until it is paid (steps 8-9). pos.html change + version bump; no sw.js logic changes.
// Previous: v0.3.30 (2026-11-10) — Till step 6, payment: Charge opens a payment screen (pos.html) with cash
//   received + change, MTN Money / Airtel Money (reference required), card, split payments, and the balance on a
//   customer's account (credit / partial, same creditStatus values as the main app). The paid receipt lists the
//   payments. NOTHING IS SAVED YET — the receipt is tagged "NOT RECORDED YET"; steps 8-9 commit the sale.
//   pos.html change + version bump; no sw.js logic changes.
// Previous: v0.3.29 (2026-11-10) — Open Till shortcuts: a row at the top of the hamburger menu's Quick
//   Actions and a full-width button under the dashboard Quick Actions tiles, both calling openTill() (same
//   plan/read-only checks as the Till tab). Hidden for Staff and in the Play build, like the Till tab.
//   index.html change + version bump; no sw.js logic changes.
// Previous: v0.3.28 (2026-11-10) — Prices are preset before any sale: every issue (single, multi,
//   commodity) is blocked until the item/commodity has a price on the 💲 Price List; a blank sale price now
//   takes the list price, a typed price is a one-off override. Sales and edits no longer rewrite the list price
//   (only the Price List does). The Price List also lists stock that has records but no item-master entry.
//   index.html change + version bump; no sw.js logic changes.
// Previous: v0.3.27 (2026-11-10) — Price List: new 💲 Prices button (Admin) on the General and Commodities
//   tabs opens one screen to set the selling price of every stock item and every commodity before any sale,
//   with search, an "only unpriced" filter, Enter-to-next-field and a single save. Stock items keep using
//   inventoryPrices[name].sellingPrice; commodities get a new sellingPrice on the commodity record. The
//   commodity Issue form and the multi-issue form now pre-fill from the list, and the Till prices commodities
//   from it (no more guessing from the last sale). index.html + pos.html change + version bump; no sw.js logic changes.
//
// v0.3.26: (2026-11-10) — The Till (pos.html) is now on every plan: pos_till moved from the
//   Pro list to the Free list in gate.js (Free, Starter and Growth get it too, and it keeps working after the
//   trial ends). The Till now also sells commodities: they appear in the item list with stock summed over all
//   batches and the latest sale price from their issue records. gate.js + pos.html + index.html change +
//   version bump; no sw.js logic changes.
//
// v0.3.25: (2026-11-09) — Item CSV import/export: Import CSV and Export CSV buttons in
//   Manage Inventory and the Item Names tab. Import matches rows to items by name and fills barcode,
//   SKU, unit, category, cost, price and VAT (optionally adding items not yet in the list), with a
//   preview before anything is written. Long item lists get a search box. index.html change +
//   version bump; no sw.js logic changes.
//
// v0.3.24: (2026-11-09) — Item master (step 1 of the point-of-sale roadmap): each
//   inventory item can now carry an id, barcode, SKU, unit, category and VAT code, edited from the new
//   Details button in Manage Inventory and the Item Names tab. Cost and selling price are edited in the
//   same form but stay in inventoryPrices (no second source of truth). No data migration: ids for
//   existing items are derived from the name. index.html change + version bump; no sw.js logic changes.
//
// v0.3.23: (2026-11-08) — App Check: reCAPTCHA site key corrected to match the console
//   exactly (two look-alike characters were swapped: "lI" should be "Ii"); Google's script reported
//   "Invalid site key". Key fixed in index.html (3 places) and mdm-admin.html. Bump only.
//
// v0.3.22: (2026-11-08) — App Check debug (?acdebug=1): messages now stay in an
//   on-screen panel with a Copy all button instead of disappearing as toasts; first line shows
//   page version, host and the key in use. Diagnostics only. Bump only.
//
// v0.3.21: (2026-11-08) — App Check: a synchronous error from grecaptcha.execute
//   (e.g. "Invalid site key") is now caught and shown instead of waiting 10s and reporting only
//   "reCAPTCHA timeout". Faster failure, clearer toast. No sw.js logic changes — bump only.
//
// v0.3.20: (2026-11-08) — App Check debug (?acdebug=1): the "skipped" toast now shows
//   the earlier failure reason instead of hiding it. Diagnostics only — no logic changes. Bump only.
//
// v0.3.19: (2026-11-08) — App Check: the reCAPTCHA site key in the code was one
//   character short (39 chars, one 'A' missing; real keys are 40), so reCAPTCHA never issued a
//   token and App Check showed 0% verified. Key corrected in all places. No sw.js logic changes — bump only.
//
// v0.3.18: (2026-11-08) — App Check fix: the reCAPTCHA→App Check token exchange
//   now sends the Firebase API key (?key=), as the SDK does — without it the exchange failed and
//   every request showed as unverified. Firebase Auth now also gets App Check tokens
//   (firebase-app-check-compat.js + activate in the <head> init block). Setup comment corrected.
//   No sw.js fetch/cache logic changes — bump only.
//
// v0.3.17: (2026-11-02) — Terms/Privacy wording: access levels and fees stated neutrally (no mention of arranging plans outside Google Play)
//
// v0.3.16: (2026-11-02) — footer reads "© <year> NEXLITE DIGITAL SOLUTIONS LIMITED"
//
// v0.3.15: (2026-11-02) — Play app (?src=play) consumption-only wording and screens; privacy policy and
//   terms brought in line with what the app actually sends to third parties. No sw.js fetch/cache logic changes — bump only.
//
// v0.3.14 (2026-11-01) — security hardening: contact details moved to a private node, depot
//   passwords no longer public for migrated depots, staff/admin roles, shared login lockout removed (Firebase
//   Auth throttles instead), App Check token on licence fetch. Needs the matching database.rules.json.
//   Play mode: the Google Play app opens /?src=play, which hides prices, payment screens and
//   payment links there (consumption-only); the website is unchanged.
//   No sw.js fetch/cache logic changes — bump only.
//
// v0.3.13: © Nexlite Digital Solutions Ltd footer links to the company site
//
// v0.3.12: photos, logos and contract scans are shrunk before they are stored
//
// v0.3.11: contact email is now support@nexlitedigitalsolutionslimited.digital
//
// v0.3.10: removed login debug output
//
// v0.3.10: removed TEMP DEBUG lines from login errors (they exposed internal depot IDs).
//
// v0.3.9 changes (2026-10-21) — Staff card: full work-log history:
//   - The staff card still opens with the 5 latest sessions; a "View all N sessions"
//     button swaps in every log for that staff member (date, task, quantity, net, paid
//     status, time in/out, deductions, notes, pending badge, edit button). Absence /
//     leave / sick entries and active shifts are labelled instead of showing 0 bags.
//     The list is built on first tap, so opening the card is no slower.
//   - Multi-role staff: each role box in "Work history by role" has its own
//     "View all N sessions as <role>" button (replaces the static "+N more" text).
//   - Display only — no data, pay or export changes.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v0.3.8 changes (2026-10-21) — Work Logs: subtotals per date and role:
//   - Work Logs table is grouped by date, then role. Each date + role block ends with a
//     Σ subtotal row: quantity per unit (bags / hours / days… never mixed), gross,
//     deductions and net. Counts approved, completed work logs only (same as the period
//     cards); pending / open logs are noted on the row. Shown when a block has 2+ logs.
//   - Subtotal rows are hidden while the search box is in use (they would not match
//     the filtered rows). Display only — no data, pay or export changes.
//   - When a date + role block has more than one task, a smaller row per task (same
//     quantity / gross / deduct / net columns) follows the overall subtotal.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v0.3.7 changes (2026-10-21) — Data-entry parity: every Edit form now matches its Add form:
//   - Edit Work Log: Role dropdown (multi-role staff) and Task list follow the chosen
//     staff/role, so a log can be moved to a task under another role; stock tag follows
//     the task; Overtime multiplier (was silently dropped on edit — OT logs lost their
//     OT pay when edited) and Notes are now editable. Priced-task check on save.
//   - Deduction lines (l.deductions[]) are kept in step with the edited total/reason.
//     Payslips read the lines first, so editing only the total used to be ignored.
//     Untouched multi-line deductions are preserved exactly (reason text no longer wiped).
//   - Attendance entries (absent / leave / sick) can now be edited (type, staff, date,
//     note); the matching leave-balance entry is updated with it.
//   - Bulk Edit Work Logs: "Task (same for all)" tick plus a Task dropdown on every row.
//     Quantity kept, earnings/rate unit recalculated at the new rate; logs whose role
//     has no such task keep theirs and are counted. Bulk edit now keeps OT pay, rate
//     unit and deduction lines consistent, and blocks attendance entries.
//   - Edit Issued Item: Customer. Edit Commodity Received: Supplier. Edit Commodity
//     Issued: Source Receive Record (traceability). Edit Staff: Date Joined.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v0.3.6 changes (2026-10-21) — Work log editing: tasks (Depot Assistant):
//   - Depot Assistant can now change the TASK on existing work logs in bulk
//     (new action bulk_edit_log_task), alongside bulk date and bulk quantity.
//     e.g. "change 20 August loading logs to stacking". Same date / task / staff
//     filters and the same edit-window + admin-password gates as the other bulk
//     edits. Quantity is kept; task, rate unit and earnings are recalculated from
//     the new task's rate. Logs whose role has no such task priced are skipped and
//     reported; the confirmation shows gross before → after.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v0.3.5 changes (2026-10-20) — Edit staff payments (single + bulk):
//   - Payments tab: ✏️ Edit beside 🗑 on every PAID row (admin only). Same guards as
//     delete: admin password + edit window. Staff is locked; date, amount, notes editable.
//   - Multi-task rows: tick / quantity / amount per task (same tick-list as Bulk Pay);
//     total is their sum; saves payTasks + payQtys. Old single-task payments open as
//     one row, plain payments as one "general, oldest first" amount.
//   - Each row's task is a dropdown of the priced tasks for that staff member's roles.
//     Switching task moves key/role/task/unit/rate together; money stays fixed and the
//     quantity is recalculated, or tick "keep quantity" to recalculate the money.
//   - One payment can be split across tasks (e.g. K300 loading + K200 stacking).
//   - Old label-only payments (task label, no payTasks): changing the task converts them
//     to targeted payments so the change really moves; the preview warns first.
//   - Review screen before saving: per task, how many entries go back to unpaid / become
//     paid. Overflow beyond a task's owed work falls into the general pool.
//   - Save keeps id, staffId, enteredBy, approvalStatus; writes an EDIT audit entry with
//     the old record. Paid/partial/unpaid is calculated live, so nothing else to fix.
//   - Payroll-run payments (runId): amount and task locked; only date and notes change,
//     so the run's payouts never go out of sync.
//   - Bulk edit: tick PAID rows (or "Select all paid" per staff) → "Edit selected" bar.
//     Change date, notes, amount (set / ± amount / ± %) and task for all; each row stays
//     editable. Payments outside the edit window, or staff without that task priced, are
//     skipped and listed. One save, one audit entry per payment, before → after total.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v0.3.4 changes (2026-10-20) — Cloud sync now sends only what changed:// v0.3.4 changes (2026-10-20) — Cloud sync now sends only what changed:
//   - Every sync used to upload ALL depot data (books, photos, contracts, logs).
//     Now the app remembers what the cloud last held and sends only the entries
//     that were added / edited / deleted (Firebase PATCH). First sync after
//     updating still sends everything once; after that only changes go up.
//   - Safe fallbacks to the old full upload: no baseline yet, another device
//     synced in between, cloud copy missing, or the server refuses PATCH.
//   - Offline edits no longer queue a full copy of all data each time (up to 50
//     copies re-sent on reconnect); the next sync sends just the changes.
//   - Full-upload time limit ceiling raised to 5 minutes for the one-off first sync.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v0.3.3 changes (2026-10-20) — Cloud sync fix ("Sync failing — signal is aborted without reason"):
//   - Root cause: the whole depot data blob is uploaded in one request and the
//     10s limit covered the entire upload, so on a weak mobile signal a large
//     blob (photos, contracts, logs) could never finish in time and sync stayed
//     broken. Not an HTTP/HTTPS problem — the database URL was already https.
//   - fbSet now scales its time limit with payload size (20s minimum, 3 min max).
//   - Timeouts now report "Connection too slow — timed out after Ns sending X KB"
//     instead of the browser's "signal is aborted without reason".
//   - No sw.js fetch/cache logic changes — bump only.
//
// v0.3.2 changes (2026-10-19) — Bulk Pay: tick the tasks to pay (staff with several roles / tasks):
//   - A person with more than one priced task now gets a tick-list instead of one amount box.
//     Every task has its own tick, quantity and amount. Type the quantity → the amount is worked
//     out from that task's rate; type the amount → the quantity is worked out. Tasks never affect
//     each other. Ticking the person ticks every task that has unpaid work; unticking clears all.
//   - The person's row shows the total of the ticked tasks: total quantity per unit (bags, days,
//     hours…) and total money. The row's amount box is read-only (it is that total).
//   - Works in every mode: Amount, From – To and Up to. In a period each task starts at its own
//     unpaid work in that period (its own quantity and money). Staff with one task are unchanged.
//   - The confirm dialog lists every ticked task (quantity + money), the person's total, then the
//     grand total quantity and money for everyone.
//   - Ticked tasks settle ONLY their own work entries: the payment is saved with payTasks and the
//     PAID / PARTIAL badges follow it (oldest entry of that task first). Money a task cannot absorb
//     falls back into the person's general pool. Payments without payTasks behave exactly as before.
//   - The Payments list shows each task's quantity + money and the total; the audit log lists tasks.
//   - Record Payment is unchanged (one task at a time).
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.3.1 (2026-10-19)
//
// v0.3.1 changes (2026-10-19) — Record Payment & Bulk Pay: pay for a period + total quantity:
//   - New "Pay for a period" box in Record Payment and in Bulk Pay, with three modes:
//       Amount   — the old way: type an amount (or a quantity).
//       From – To — pick two dates; the amount is the unpaid work dated between them.
//       Up to    — pick one date; it starts from the person's LAST PAY (the first work entry
//                  that is not fully paid yet) and pays everything up to that date.
//   - "Unpaid" is read from the same oldest-first allocation as the PAID / PARTIAL badges, so a
//     part-paid entry only counts what is still owed. In Bulk Pay each person gets their own
//     amount, quantity and start point; people with nothing unpaid are left unticked.
//   - The amount stays editable (part-payment); the quantity scales with it.
//   - Payments still settle the OLDEST work first. If a From – To period starts after older
//     unpaid work, a warning says that work will be settled first.
//   - Total quantity line at the bottom of both forms, totalled per unit (bags, hours, days,
//     trips, tons, custom units like month). Salaried staff show months (amount ÷ monthly salary).
//   - The period is saved on each payment (payMode / payFrom / payTo / payQtys), shown in the
//     Payments list, the confirm dialog and the audit log.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.3.0 (2026-10-19)
//
// v0.3.0 changes (2026-10-19) — Bulk Pay: pay by quantity of work (hours, bags, days…):
//   - Bulk Pay now has the same amount ⇄ quantity link as Record Payment. Every staff row
//     with a priced task gets a quantity box (Hours Worked, Bags Handled, Days Worked, Trips,
//     Tons or a custom unit, whatever that task is rated in) next to the amount. Type the
//     quantity and the amount is worked out from the task rate; type the amount and the
//     quantity is worked out. Staff with more than one priced task get a task picker, starting
//     on the task they last logged work under. Changing the task recalculates from whichever
//     box was edited last.
//   - New "Quantity of work — same for everyone ticked" field next to the same-for-everyone
//     amount. Use it with a role filter so everyone shares one unit (e.g. all loaders, bags).
//   - The quantity is saved with each payment (payQty / payTask / payUnit / payRate), shown in
//     the confirm dialog, the Payments list and the audit log, exactly like Record Payment.
//   - Salaried staff and staff with no priced task have no quantity box — amount only.
//   - Record Payment already had amount ⇄ quantity (v0.0.4) and is unchanged.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.9 (2026-10-19)
//
// v0.2.9 changes (2026-10-19) — cloud sync recovers from "HTTP 401 Permission denied":
//   - A 401 while a token was attached now force-refreshes the Firebase ID token and
//     retries once (fbGet / fbSet) before reporting a failure. Fixes stale tokens, including
//     phones whose clock is off so the SDK thinks an expired token is still valid.
//   - After a silent "Stay Signed In" start, requests wait up to 8s for the Auth session to
//     finish restoring instead of going out with no token (the old 4s limit was too short on
//     slow phones). Backs off for 30s after a miss so a truly lost session isn't slowed.
//   - The "not authorized" self-heal no longer loops. It used to clear its flag and re-sync
//     even when the grant write failed (which it always does for a uid not yet listed),
//     retrying every few seconds. Now one attempt per 10 min; the flag clears only if the
//     grant worked, so Settings and the pill show the real state.
//   - A successful cloud read clears stale "reconnect" / "not authorized" state, and the
//     Settings "Last cloud sync" label refreshes after every push instead of every 5 min.
//   - The "Not Authorized" dialog now shows the exact Firebase console path to add the uid.
//   - database_rules.json unchanged. No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.8 (2026-10-19)
//
// v0.2.8 changes (2026-10-19) — Payroll Run and the stock check are Pro plan features:
//   - Two new Pro feature keys: 'payroll_run' (Payroll Run) and 'stock_check' (Payroll
//     Stock Check). Both are added to TIER_FEATURES.pro, the upgrade-prompt labels and the
//     Pro card's bullet list, so the upgrade screen names them and sends people to Pro.
//     Trial still counts as Pro, so trial depots keep everything while the trial runs.
//   - Payroll Run gate: 🧮 Payroll (Staff tab) shows a 🔒 on Free / Starter / Growth and opens
//     the upgrade screen instead of Prepare Payroll. The steps that write data are gated too,
//     so a plan that lapses while the screen is open cannot finish: Review & lock run, the lock
//     itself, and Create payments (both the opening screen and the confirm button).
//   - Stock check gate: the 📦 Stock check tab inside Prepare Payroll shows a locked card, and
//     the "✓ 21,000 of 21,000 paid for" badge on stock rows is hidden (not locked, so stock
//     rows stay clean) with its breakdown screen refusing to open.
//   - Settings: the Stock Check Tolerance and NAPSA / NHIMA / PAYE sections show a locked
//     block with an Unlock button instead of the fields.
//   - Depot Assistant: "prepare payroll" says it needs Pro instead of opening the screen.
//   - NOT gated, on purpose: stock links on tasks, the commodity / batch tag on work logs,
//     who-entered-it records, the delete-stock warning, Advances & Loans and Labour Cost per
//     Bag. These are data entry and reports that were already there. Nothing stored is
//     touched or hidden: locked runs, payments already made and loan balances are kept and
//     still count in every other screen. They reappear in Payroll when the plan is Pro again.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.7 (2026-10-18)
//
// v0.2.7 changes (2026-10-18) — Advances & loans: reports, statements, Depot Assistant, staff view:
//   - GAP FIXED from v0.2.6: instalments taken from pay settle a person's work, but
//     several screens worked out "paid" / "unpaid" from staff payments alone, so a
//     withheld instalment would have shown as unpaid wages. Now counted everywhere:
//     Staff → Payments (per-role totals and each person's statement, which gets a
//     LOAN row "instalment withheld · run #n · no cash paid"), staff profile and profile
//     PDF, the monthly payslip (extra "Loan / advance instalment withheld" line and the
//     outstanding balance), the Staff Earnings CSV, and the period summary's payroll
//     table. Unpaid balances now agree with Prepare Payroll.
//   - Cash Flow: advances and loans handed to staff are cash OUT (breakdown row, totals
//     and the monthly trend); repayments received directly are cash IN. Instalments taken
//     from pay are not cash: they appear as a muted "withheld" line that is not counted,
//     because the staff payment is already net of them. Footnote explains this.
//   - Profit & Loss: no change to profit (a loan is not an expense); the "Staff actually
//     paid" note now also shows loan instalments withheld in the period.
//   - Depot Assistant: Admin accounts are given every loan with balance, repaid, status
//     and next instalment already worked out (loans are never date-trimmed, so an old loan
//     that is still owed is not missed) plus recent repayments, and the prompt explains
//     'payroll' (taken from pay, no cash) vs 'manual' (paid back directly) repayments.
//     Loan words (loan, advance, instalment, owe, repay…) pull in the staff topic. Manager
//     accounts get NO loan data — Advances & Loans is an Admin-only screen, so the Assistant
//     is not a side door. Staff logins get only their own loans (myLoans).
//   - Staff login dashboard: a "My Advances & Loans" card (own loans only) with what is
//     still owed and the next instalment; hidden when there is nothing outstanding.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.6 (2026-10-18)
//
// v0.2.6 changes (2026-10-18) — Advances & loans with automatic instalments:
//   - Staff tab → 🏦 Advances (Admin) and a 🏦 Advances & Loans button on each staff
//     profile (shows what the person owes). Record an Advance or a Loan: staff member,
//     amount, date given, how it was paid out (cash / Airtel / MTN / bank) and a
//     reference, then the repayment plan — number of instalments, one every month or
//     week, and the first due date (month-end by default). The form previews the
//     schedule (e.g. 4 × K225.00, 31 Oct → 31 Jan; the last instalment absorbs
//     rounding) and warns if the person already owes money. Admin password to save.
//   - Instalments come out of pay automatically. Prepare Payroll takes, per person,
//     everything scheduled up to the period end minus everything already repaid, so a
//     missed instalment is caught up by itself. It is capped at the pay available
//     (never makes net pay negative); whatever could not be taken stays due, is shown
//     on the person's card and listed under ⚠ Problems. A Pay-up-to hold is protected
//     first: instalments only come out of pay that is released in this run.
//   - Locking a run records the instalments (DATA.loanRepayments, source 'payroll')
//     and stores them in the run snapshot (loan, loan balance left, loanItems). They
//     settle the person's oldest work exactly like a payment does, so the pay-now
//     figure in Create payments is already net of the instalment and nobody is paid
//     the withheld amount twice. No cash moves, so they are not staff payments and do
//     not appear in the payments list or Cash Flow. Run cards, the review list and the
//     summary show the instalments; payslips (PDF and WhatsApp) show a "Loan / advance
//     instalment" line and the loan balance remaining.
//   - Per loan: ＋ Repayment (the person pays back directly — lowers the balance only,
//     wages untouched), 🗓 Reschedule (new plan for what is left, e.g. skip a month;
//     earlier repayments kept), ✂ Write off (partial or full, with a reason; the record
//     stays) and 🗑 Delete (only before any repayment). Each writes an audit entry.
//   - The loan itself is not a payment and never enters the oldest-first pool. A loan
//     paid out in cash lowers the Create-payments cash estimate; a cash repayment
//     received directly raises it. Problems also flags someone who has left while
//     still owing money.
//   - Stored in DATA.staffLoans / DATA.loanRepayments (both included in Clear All Data
//     snapshots). They sync inside depots/<id>/data, so database_rules.json is unchanged.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.5 (2026-10-18)
//
// v0.2.5 changes (2026-10-18) — Productivity report + Gang split:
//   - Staff tab → 📈 Productivity (Admin + Manager). Output per person per shift,
//     task by task, for the chosen period. A shift is one person's work on one
//     task in one day (two clock-ins the same day on the same task are one
//     shift). Per person: shifts, total, average per shift, best shift, output
//     per hour (only from logs that have time in/out) and the gap to the task's
//     average. A by-day table shows crew size against output and each person's
//     average that day. Filter: All shifts / Solo only / Gang only.
//   - Counts approved, completed work logs with a quantity. Day-rate and hourly
//     tasks, salaried staff and late/pooled stock-gap logs are left out; units
//     are never mixed across tasks. Read-only.
//   - Staff tab → 👥➗ Gang Split (Admin + Manager). One total for the whole gang
//     on one role, task and date, shared out as an ordinary work log per person:
//     equally, by hours worked (prefilled from time in/out, editable), or by a
//     custom share (e.g. 1.5 for a team leader). Shares always add up to the
//     total exactly; bag tasks can be split in whole bags (default).
//     Live preview of each person's share and the total pay before saving.
//   - Gang logs carry the stock tag (remembered like Bulk Log), the same approval
//     rules (Manager entries wait as pending) and an audit entry. Each log has a
//     gangId, so the Work Logs row shows a 👥 Gang split chip (people and total
//     worked out from the gang's own logs) and Productivity can separate them.
//     Pay, payments, stock check and payroll treat them as normal work logs.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.4 (2026-10-18)
//
// v0.2.4 changes (2026-10-18) — Stock rows: "paid for" badge + Labour budget:
//   - Received / Issued rows (commodities and general inventory) whose stock has a
//     linked task get a small badge, e.g. "✓ 21,000 of 21,000 paid for". Tap it for
//     the per-task breakdown (admin also sees labour earned, paid and per bag).
//   - "Paid for" = bags on approved work logs tagged to that commodity / item,
//     counted as paid in the same proportion as the staff member's payments have
//     settled them (oldest work first, as in Paid / Partial / Unpaid). Each task is
//     counted on its own, so offloading + stacking never add up. A log goes to the
//     stock record nearest its date (same batch when tagged); spill-over goes to the
//     next nearest, and bags beyond the stock show as "over". The stock-check
//     tolerance decides when a small gap still shows ✓. Hidden from Staff logins.
//     Amber = some bags not logged or not yet paid, red = more logged than stock.
//   - Budget targets get an optional Labour Budget. Budget vs Actual shows it against
//     Actual Pay (earnings − deductions on approved work logs tagged to the item in
//     the selected period) with a used-% bar, what is left or over, and how much of
//     it has been paid out. A Labour summary row totals every line that has one.
//     A target can now be saved with only a labour budget.
//   - Read-only apart from the new budget field; no pay figure changes.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.3 (2026-10-18)
//
// v0.2.3 changes (2026-10-18) — Profit & Loss: Labour cost per bag:
//   - The Profit & Loss view (General Inventory and Commodity tabs) gets a
//     Labour Cost per Bag section, under the Cost of Goods Sold breakdown and for
//     the same period as the rest of the report.
//   - Source: approved, closed work logs tagged to a commodity or inventory item,
//     grouped by commodity/item and direction (Received / Issued), then by batch
//     ("All batches" plus one line per batch; logs with no batch show as "No
//     batch"). Labour = earnings − deductions, the same measure as Staff Wages.
//   - Each task is worked out on its own (task cost ÷ bags that task logged) and
//     a line's per-bag figure adds its tasks together, so a bag that is offloaded
//     and then stacked is not counted twice. Tap a line for the task breakdown.
//   - Labour on tasks that logged no bags (day rate) is shown as "no bags logged"
//     and kept out of the per-bag figure. Salaried staff and untagged logs are not
//     in the section; the footnote says how many untagged logs and how much.
//   - Read-only; nothing is saved. No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.2 (2026-10-18)
//
// v0.2.2 changes (2026-10-18) — Payroll: Batch payslips:
//   - Each locked run in the Runs view gets a 🧾 Payslips button (Pro, admin).
//     The window lists everyone in the run with a tick box (all / none / only
//     people paid now).
//   - 📄 One PDF: every ticked person on their own page, from the run's locked
//     snapshot (earnings, salary, carried forward, deductions, unpaid leave,
//     earlier payments, advances, net payable, held to the next run, pay now,
//     and the payment method and reference once paid). Print / Save PDF, or
//     Share from the print window.
//   - Per person: 🧾 PDF (single page) and 💬 WhatsApp, which opens a chat with
//     the number on the staff profile (260XXXXXXXXX) with the payslip as text.
//     A WhatsApp link cannot attach a file; use the person's PDF + Share for that.
//     People with no usable phone number show "no phone number".
//   - Each export writes an audit entry. Run figures are never changed.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.1 (2026-10-18)
//
// v0.2.1 changes (2026-10-18) — Payroll: Mobile money CSV:
//   - New 📱 Mobile money CSV button in the Create payments form (the ticked
//     people paid by Airtel or MTN, before you pay) and on each locked run in
//     the Runs view (its recorded Airtel/MTN payouts).
//   - Columns: Name, Phone, Amount, Network, Reference. Phone comes from the staff
//     profile, written as 260XXXXXXXXX (0977… and 977… are converted). Rows are
//     sorted by network then name; download all, MTN only or Airtel only (portals
//     usually take one network at a time), or copy the CSV as text if downloads
//     are blocked. A real CSV file is built because the app's _csvDownload()
//     prints a PDF. Each download writes an audit entry.
//   - People with no usable phone number are left out and listed in red. A number
//     whose prefix looks like another network (MTN 96/76, Airtel 97/77, Zamtel
//     95/75) is flagged in amber but kept.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.2.0 (2026-10-18)
//
// v0.2.0 changes (2026-10-18) — Payroll: Cash notes + cash-balance warning:
//   - Create payments (from a locked run) gets a 💵 Cash block. It counts only
//     people paid in cash (the default method or a per-person override) and
//     updates live as you tick people or change methods.
//   - Cash note breakdown: the notes needed in total (for the withdrawal) and
//     per person (for envelopes), largest first, e.g. K100 × 12 · K50 × 3. The
//     note list is editable and defaults to 100, 50, 20, 10, 5, 2, 1 (1000, 500,
//     200, 100, 50 when the depot currency is KES). Anything below the smallest
//     note shows as "in coins".
//   - Cash available starts as an estimate from the app's records (all-time cash
//     sales in, minus stock purchases, minus cash staff payments; no opening
//     balance; payments with no method count as cash) and can be overwritten with
//     the cash actually held. A red warning shows when the cash payments are more
//     than it; an amber note shows when the whole payroll is more but the cash
//     part is not. The final confirm repeats the red warning. It never blocks.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.9 (2026-10-18)
//
// v0.1.9 changes (2026-10-18) — Payroll: Create payments from a locked run:
//   - Runs view: each locked run with people still owed shows 💸 Create
//     payments. The form has a payment date, a default method (Cash / Airtel /
//     MTN / Bank), a batch reference (prefilled RUN-<n>) and, per person, a tick,
//     a method override and an optional transaction reference.
//   - Admin password, then a confirm that says how many work entries get marked
//     paid. One staff payment is made per person (the run's pay-now figure), so
//     the existing oldest-first logic marks the oldest unpaid work as paid.
//   - Each payment stores method, reference, runId and runNumber, and shows
//     "RUN #n · METHOD · REF" in its note; one audit entry per payment.
//   - A person is paid once per run (run.payouts). Unticked people can be paid
//     later from the same run. The run's locked figures are never changed.
//   - Salaried payments get forDate = the run's period end, and Prepare Payroll
//     now counts a salaried payment by forDate (else its date), so paying a run
//     after the period ends does not reduce the next period's salary.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.8 (2026-10-18)
//
// v0.1.8 changes (2026-10-18) — Payroll: Review & lock the run:
//   - Pay view gets 🔒 Review & lock run (admin). The review lists each person
//     with their pay-now figure; every person must be ticked before Lock is
//     enabled. A warning shows if Problems still has items to fix. The lock
//     needs the admin password and refuses if the figures changed since the
//     review was opened, or if a locked run already covers the period/group.
//   - Locking saves an immutable snapshot to DATA.payrollRuns (synced and
//     snapshotted like other records): period, group, end date, Pay-up-to
//     limit, each person's earnings/salary/deductions/leave/paid/advance/net/
//     held/pay, the held entries (the carry-forward), totals and who locked it.
//     An audit entry is written. There is no unlock; fix things in the next run.
//   - New 🔒 Runs view lists locked runs, newest first, with each person's pay.
//   - Carry-forward and corrections: the next run (any period starting after a
//     locked run ended) adds "Carried forward" to net pay = unpaid work from
//     before its period. That is live, so it already holds the entries a run
//     held back and any later correction (a late, edited or newly approved log)
//     inside a locked period. The correction (live − snapshot) is shown beside
//     it. Before any run is locked nothing changes (old info-only line stays).
//   - Pay recording is unchanged: locking does not create payments (next step).
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.7 (2026-10-18)
//
// v0.1.7 changes (2026-10-18) — Payroll: End at last work day:
//   - New "End at last work day" switch under the period buttons in Prepare
//     Payroll. When on, the end date for work logs and stock becomes the latest
//     day any (non-rejected) work was logged in the period, and is shown next
//     to the switch. Stock recorded after that day is left out of the stock
//     check (and of the "pending stock records" problem) and waits for the
//     next run, so it no longer shows as a gap against work not yet done.
//   - Gap actions (late log) and the Pay up to date default use the same end.
//   - Salary proration, leave and payments are NOT shortened; they still use
//     the chosen period dates. Off by default; not saved between sessions.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.6 (2026-10-18)
//
// v0.1.6 changes (2026-10-18) — Payroll: Pay up to (cut-off):
//   - Payroll → Pay view gets a ⏸ Pay up to card (Off / Date-time / Bags).
//     Work is counted oldest-first (date, time, id); anything past the limit
//     is held and left out of this run. Review-only: nothing is saved or paid.
//       Date / time  holds work after the chosen date (and time of day, if set).
//       Bags         pays per-bag work up to N bags; the log at the limit is
//                    split (e.g. 80 paid, 20 held). The hold on that cut day
//                    comes from the last entries (default), is shared across
//                    the day in proportion, or is taken first from entries you
//                    tick. Entries after the cut day are held whole.
//   - Each person's card shows "Held back" and a PAY NOW figure; the summary
//     shows To pay (after holds) and Held back, with the held entries listed.
//   - Held amount per person is capped at their positive net, so a person paid
//     ahead is never shown as overpaid because of a hold. Salaried staff and
//     non-bag work are never held by a bags limit.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.5 (2026-10-18)
//
// v0.1.5 changes (2026-10-18) — Payroll: Problems list:
//   - Payroll screen gets a third view, ⚠ Problems (with a count; red when
//     something needs fixing). It follows the chosen period and group and
//     lists, in two levels:
//       Fix before paying — open shifts (also ones left open from before the
//         period; button: Clock out), missing rates (a task with no rate, a task
//         that no longer exists under its role, logs that earned nothing although
//         the task now pays, a salaried person with no monthly salary), and
//         negative net pay.
//       Check — pending entries (work logs, payments, leave, and the pending
//         stock records the stock check is waiting on), duplicates (identical
//         work logs or payments), zero quantities, and unusually high pay (a log
//         at 3x the task's usual quantity or more, or a person at 3x the group's
//         median earnings).
//   - Each item has a button to where it is fixed (clock-out form, staff
//     profile, pending approvals, Roles & Rates). Read-only: nothing is blocked
//     or changed by the list itself.
//   - "Unusually high" is deliberately cautious: it needs 6+ earlier logs of the
//     task (or 4+ people) to form a baseline, ignores day-rate tasks, ignores
//     late/pooled gap logs, and only looks at non-rejected entries.
//   - The Pay view shows a tappable banner when there are problems.
//   - Date and group changes now refresh the problem count too.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.4 (2026-10-18)
//
// v0.1.4 changes (2026-10-18) — Stock check: gap actions:
//   - Every gap row in Payroll → Stock check (a gap outside the tolerance) now
//     has four admin-only actions, so a gap can be fixed or explained on the spot:
//       ＋ Late log    add a missed work log for one person (stock > logged).
//                      Pick the person (and role), a date inside that month and
//                      period, and the bags (starts at the gap). Shows the pay
//                      and the gap that will remain.
//       👥 Pooled log  share the missing bags across the crew who logged that
//                      task on a chosen day (starts at the month's latest work
//                      day). Split equally or in proportion to bags logged that
//                      day; untick anyone to leave them out. Shares add up to
//                      the total exactly; each person gets their own log in the
//                      role they worked that day. Salaried staff are never pooled.
//       ✂ Write off   accept the gap with a reason (preset reasons for a +
//                      gap or a − gap, a note is required for "Other"). Partial
//                      write-offs are allowed. Needs the admin password. The row
//                      shows ✓ WRITTEN OFF once the rest is within tolerance,
//                      with an Undo (admin password) that keeps the history.
//       ⏸ Hold        park the gap as unresolved with a note; the row shows
//                      ⏸ HELD until a log fixes it, it is written off, or the
//                      hold is released. A hold changes no pay yet — it is the
//                      marker the payroll lock will read.
//   - Late and pooled logs are ordinary approved work logs, tagged to the same
//     commodity/item as the gap row (and marked gapAction late/pooled, with a
//     note), so they raise "logged" and the gap closes by itself. Each action
//     returns to the stock check afterwards.
//   - Write-offs and holds are stored in DATA.stockGapActions (synced with the
//     rest of the depot data, snapshotted by Clear All Data) and every action
//     writes an audit entry.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.3 (2026-10-18)
//
// v0.1.3 changes (2026-10-18) — Stock check tolerance:
//   - New Settings → Staff & Records Policy → "Stock Check Tolerance (%)",
//     default 0.5, 0–10, saved with the admin password (depotInfo.stockTolerancePct).
//   - In Payroll → Stock check, a gap within that % of the month's stock now
//     shows ✓ "WITHIN 0.5%" (the gap itself is still shown in the row text).
//     0 means exact match only. With no stock but logged bags, any gap is a
//     real gap — the tolerance is measured against stock.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.2 (2026-10-18)
//
// v0.1.2 changes (2026-10-18) — Stock check per task, per month:
//   - Payroll screen gets a 📦 Stock check view. For each per-bag task with a
//     stock link, and each calendar month in the chosen period: stock bags
//     (approved received/issued records of the task's commodities/items),
//     logged bags (approved work logs of that task) and the gap (stock −
//     logged). + = stock with no work logged, − = more logged than stock.
//   - Rows are per commodity/item so different commodities never get mixed;
//     logs with no stock tag show as "Not tagged". The same task name under
//     several roles is counted together. Tasks not paid per bag are listed as
//     not checked. Stock counted in a unit other than bags is flagged.
//   - Read-only; no tolerance yet (a gap shows ✓ only when exactly zero).
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.1 (2026-10-18)
//
// v0.1.1 changes (2026-10-18) — Prepare Payroll (review screen):
//   - Staff tab → 🧮 Payroll (admin). Choose a period (this month, last month,
//     last 7 days, custom dates) and a group (all staff or one role).
//   - Each person's net pay = earnings + prorated salary − deductions −
//     unpaid leave − paid already − advances, from APPROVED entries only.
//     Salary is prorated month by month (joined/left mid-period handled);
//     unpaid leave = "Absent (Unexcused)" days for salaried staff; "paid
//     already" and "advance" use the app's existing oldest-first payment
//     allocation. Unpaid work from before the period is shown, not added.
//   - Read-only screen: nothing is saved or paid yet (lock / payouts come in
//     later steps). Pending entries in the period are flagged, not counted.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.1.0 (2026-10-18)
//
// v0.1.0 changes (2026-10-18) — Warn before deleting stock that work logs depend on:
//   - Deleting a received/issued record (general inventory or commodity) now
//     warns when approved work logs are tagged to the same commodity/item in
//     the same direction (for commodities: no batch on the log, or the same
//     batch). Covers single delete, bulk delete and the Depot Assistant's bulk
//     delete preview. Shows the log count and bags; admin can still go ahead.
//   - Only APPROVED logs are counted — pending and rejected ones are not
//     official data yet. A log shared by several selected records counts once.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.0.9 (2026-10-18)
//
// v0.0.9 changes (2026-10-18) — Every record shows who entered it (admin too):
//   - ROOT CAUSE: stampEntry() only wrote enteredBy/enteredByRole/enteredAt
//     for non-admin accounts, so anything the admin entered carried no author.
//   - FIX: stampEntry() now stamps enteredBy, enteredByRole, enteredAt for
//     every account, plus enteredByStaffId (the staff profile linked to that
//     login, when there is one). Approval behaviour is unchanged: admin
//     entries are approved at once, others stay pending.
//   - index.html: new enteredByStaff()/enteredByLabel()/enteredByTag(). Every
//     row that shows approvalBadge() now also shows "✍ by <staff name> (login)"
//     and the Pending Approvals cards show the same, with the name opening the
//     staff profile. Older records without an author show nothing extra; if
//     only the login name was stored, the profile is looked up from the
//     login's current staff link.
//   - No sw.js fetch/cache logic changes — bump only.
//
// Current version: v0.0.8 (2026-10-18)
//
// v0.0.8 changes (2026-10-18) — Signup no longer depends on the phone's clock:
//   - ROOT CAUSE: a brand-new depot gets into depots/<id>/authorizedUids only
//     if licenses/<id>/createdAt is within 5 minutes of Firebase's clock
//     (rule: createdAt > now - 300000). signupFinish() wrote createdAt from
//     Date.now() on the phone, so a phone whose clock ran more than 5 minutes
//     behind could never claim its own new depot — the grant and the
//     depots/<id>/auth write were both refused.
//   - FIX: createdAt on the license record is now {'.sv':'timestamp'}, i.e.
//     stamped by the Firebase server. trialStart stays device time (the rules
//     don't read it).
//   - index.html: rules comment brought up to date — licenses/ and
//     subscriptionRequests/ operator-only read (published rules), and the old
//     "no real Firebase Auth / licenses write must be unconditional" KEY POINTS
//     replaced with what is true now.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.0.7 (2026-10-18)
//
// v0.0.7 changes (2026-10-18) — "Delete My Account" now really deletes cloud data:
//   - ROOT CAUSE: _executeAccountDeletion() issued DELETE depots/<id> as one
//     request, but the Firebase rules only granted .write on the CHILD nodes
//     (data, auth, meta, notifications, copilotChats, authorizedUids/<uid>),
//     never on depots/<id> itself. A delete of the parent node needs write
//     access at the parent, so Firebase refused it — and the app's
//     .catch(()=>{}) hid the error. The phone was wiped and "Account deleted"
//     was shown while the whole depot stayed in the cloud.
//   - RULES CHANGE (publish in Firebase Console → Realtime Database → Rules):
//     inside depots → "$depotKey": { ... } add as the first line
//       ".write": "auth.uid != null && data.child('authorizedUids').child(auth.uid).exists() && !newData.exists()",
//     Delete-only (!newData.exists()) and only for a member of that depot, so
//     it grants nothing beyond what data.write already allowed.
//   - index.html: usernames/ are now freed BEFORE the depot node is deleted
//     (the usernames delete rule needs authorizedUids, which lives inside the
//     depot — deleting the depot first would orphan the usernames). The depot
//     delete is no longer swallowed: if it fails, the error is shown and local
//     data is NOT wiped, so the admin can simply retry.
//   - Until the rules change is published, Delete My Account will show that
//     error instead of falsely reporting success.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.0.6 (2026-10-18)
//
// v0.0.6 changes (2026-10-18) — Bulk Pay (per role / multi-role):
//   - Staff tab now has a "💳👥 Bulk Pay" button (Admin only) next to Pay.
//     Tap one or more role chips to narrow the list (none = everyone), tick
//     who to pay and adjust each person's amount; amounts start at each
//     person's unpaid balance. Shared Date and Notes, a "same amount for
//     everyone ticked" quick-fill, Pay Full Balance / Select All / Clear All,
//     and a "hide staff with nothing owed" toggle (on by default).
//   - Each row shows what the amount will do to that person's oldest work
//     (✓ n entries paid · ◐ n part-paid · advance if it exceeds the balance),
//     and a running total sits above the Pay button. Only staff currently
//     shown by the filter are ever paid; ticked-but-hidden staff are flagged.
//   - Saving asks for the admin password once for the whole batch, then a
//     summary confirm (declining brings the form back as it was). It writes
//     one normal payment record per person — so each settles their oldest
//     unpaid work first — plus one audit entry per payment, in a single save.
//   - Salaried staff are listed (unticked, blank) with their monthly salary
//     shown; leavers appear only while they still have an unpaid balance.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.0.5 (2026-10-18)
//
// v0.0.5 changes (2026-10-18) — Payments settle earlier work, oldest first:
//   - Every approved payment for a staff member now goes into one pool that
//     is spent on that person's approved, completed work logs from the
//     OLDEST date forward (same date → creation order). A log shows ✓ PAID
//     when the pool covers its full net (earnings − deduction), PARTIAL when
//     it covers part (with "K x of K y"), and UNPAID when nothing has reached
//     it yet. Marks appear under Net in Staff → Work Logs, on WORK rows in
//     Staff → Payments, in a staff profile's recent sessions, and on a Staff
//     login's own dashboard. Searching the log table for "unpaid" filters to
//     the unpaid rows.
//   - The status is derived, not stored on each log, so it stays correct if a
//     payment is deleted, a log is edited, or an entry is approved later —
//     and payments recorded before this version settle work the same way.
//     Salaried staff are skipped (their pay isn't tied to work logs).
//   - Record Payment now shows the staff member's unpaid work (with a "Pay
//     all" shortcut) and, as an amount or quantity is typed, exactly which
//     earlier work entries it will settle — full or part, with the matching
//     quantity for a part-paid entry. The confirm dialog and audit log say how
//     many entries were marked paid / part-paid.
//   - Work-log CSV export gains "Paid Status" and "Paid Amount" columns.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.0.4 (2026-10-18)
//
// v0.0.4 changes (2026-10-18) — Record Payment: amount ⇄ unit quantity:
//   - Staff → Payments → Record Payment now has a "Paid For (task & rate)"
//     selector (defaults to the task the staff member last logged work
//     under) and a quantity field in that task's unit of measure (bags,
//     days, hours, trips, tons or custom).
//   - Type a money amount and the equivalent quantity fills in (amount ÷
//     rate); type a quantity and the amount fills in (quantity × rate).
//     Changing staff or task re-calculates from whichever field was edited
//     last. Salaried staff and staff with no priced task see the form as
//     before.
//   - The unit equivalent is saved with the payment (payQty/payTask/
//     payUnit/payRate), shown in the confirm dialog and in the payment row.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.0.3 (2026-09-22)
//
// v0.0.3 changes (2026-09-22) — Bulk Clock In/Out UX matched to Bulk Log:
//   - Bulk Clock Out now mirrors Bulk Log Work's layout: "same for
//     everyone" Quantity and Deduction quick-fill fields at the top
//     (still hand-editable per row), a per-row note indented under each
//     name, and a batch note that fills in for any row left blank.
//   - Bulk Clock In now supports multiple tasks in one batch: each staff
//     row gets its own Task selector, so a role with more than one task
//     no longer forces everyone onto the same one. A "Task (same for
//     everyone)" quick-fill at the top still fills every row in one go.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.0.2 (2026-09-22)
//
// v0.0.2 changes (2026-09-22) — Bulk Clock Out:
//   - Staff tab now has a "👥⏹ Bulk Clock Out" button (Admin only) next to
//     Bulk Clock In. Lists every open shift (optional role filter), and
//     closes out any selected combination with one shared Date/Time Out.
//   - Each row keeps its own Quantity (skipped for salaried staff),
//     Deduction (reason + amount), and Notes, since those vary per person.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.0.1 (2026-09-07)
//
// v0.0.1 changes (2026-09-07) — Depot Assistant topic-detection fix:
//   - "staff" topic keyword regex was missing task-name terms (stitch,
//     stitching, loader, loading, task), so a question comparing a work
//     task (e.g. stitching) against stock (e.g. maize received) only
//     pulled in the stock topic and left staffLogs out of scope.
//   - Added those terms to COPILOT_TOPICS.staff.keywords in index.html.
//
// v0.0.0 changes (2026-08-30) — Versioning scheme reset:
//   - Switched from the flat "v0.NN" counter to a three-segment "x.y.z"
//     scheme, each group capped at 10 (0-9) before rolling over to the
//     next — e.g. v0.0.9 → v0.1.0, v0.9.9 → v1.0.0. Reset to v0.0.0 to
//     start the new scheme; no functional changes in this bump.
//
// v0.29 changes (2026-08-30) — Bulk Edit Work Logs: per-record editing:
//   - The "Bulk Edit Work Logs" modal now lists every selected record as
//     its own row (Staff · Task · Date, plus editable Date/Qty/Deduction/
//     Reason/Notes), pre-filled with that record's current values — so you
//     can tweak individual logs, not just apply one shared value to all.
//   - The "same for all" tick-a-field controls at the top still work as
//     before: ticking a field there overrides that field on every row,
//     regardless of what's typed into the individual rows. Leave it
//     unticked to use each row's own (possibly edited) value instead.
//   - Earnings are recalculated per record from its own qty and task rate,
//     whichever qty source (bulk or individual) applied to it.
//
// Current version: v0.28 (2026-08-30)
//
// v0.28 changes (2026-08-30) — Bulk Edit Work Logs, more fields:
//   - The "Bulk Edit Work Logs" modal (Staff → work log table → select rows →
//     Edit Selected) previously only let you change Date. It now also
//     supports: Quantity (earnings are recalculated per record using that
//     record's own task rate — so mixed-task selections stay correct),
//     Deduction, Deduction Reason, and Notes. Same as before, only ticked
//     fields are applied; unticked fields are left as-is on each record.
//
// Current version: v0.27 (2026-08-30)
//
// v0.27 changes (2026-08-30) — Suspend/Reactivate Account:
//   - Settings → Data & Backup → My Account redesigned: header is now plain
//     "My Account" (not red), and the permanent-delete warning is no longer
//     shown by default. Two buttons sit side by side: "⏸ Suspend My Account"
//     and "🗑 Delete My Account" — each opens its own warning modal (with
//     admin password confirmation) only when tapped.
//   - New reversible "Suspend My Account" action: locks the entire app
//     read-only for everyone (including Admin) via the existing license
//     read-only banner/mode, without touching any data. Only an Admin can
//     reactivate it, from the same My Account screen ("▶ Reactivate My
//     Account"), which is exempted from the readonly button-lock so it's
//     never permanently stuck.
//
// Current version: v0.26 (2026-08-30)
//
// v0.26 changes (2026-08-30) — Settings now require admin password on every change:
//   - Company info, roles/tasks (add), shift hours, accent colour, logo
//     upload/remove, leave entitlement, edit window & staff edit window,
//     auto-logout & per-role timeouts, recovery PIN/email, add user, add
//     inventory item, and restoring a backup now all require the admin
//     password confirmation modal before the change is applied — matching
//     the gate already used for deletes.
//   - Fixed several Edit modals (Received/Issued Item, Transport Entry,
//     Commodity Received/Issued, Work Log) that showed a hardcoded
//     "Edits close 24 hrs after entry" message instead of reflecting the
//     actual configured Record Edit Window / Staff Records Edit Window.
//   - Bulk Log Work now supports an optional per-staff note on each row,
//     falling back to the shared batch note when a row has none.
//   - "My Account" danger-zone section (Settings → Data & Backup) relabeled:
//     button is now "🗑 Suspend/Delete My Account" (was "Delete Account & Data").
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.20 (2026-08-28)
//
// v0.20 changes (2026-08-28) — Depot Assistant: lean, on-topic context:
//   - Chat questions no longer get the entire depot dumped into every
//     request. buildCopilotContext() now scans the question for date
//     language ("last month", "in April", "today", "last 10 days", "all
//     time", etc.) and topic language (staff/pay, stock/commodities,
//     transport, finance/cash, books, contacts, audit) and sends only the
//     matching date window and data groups. No date or topic keyword
//     matched → falls back to sending everything, same as before, so
//     open-ended questions still get a full picture.
//   - Every log-style array is still hard-capped at 1000 records regardless
//     of window, so an "all time" question on an old depot can't blow the
//     payload back up.
//   - New "dataScope" and "dataCoversFrom" fields in the context tell the
//     model exactly what it was and wasn't sent; system prompt now has it
//     say so plainly (instead of guessing) when a question needs a topic
//     or date range that wasn't included.
//   - Root cause this addresses: the full-dataset payload sent on every
//     question was large enough to regularly blow past the 45s request
//     timeout on mobile data — this was the source of the repeated
//     "Request timed out" errors in Depot Assistant.
//   - Reconciliation mode is unaffected — still gets the complete,
//     untrimmed dataset (no question to scope against).
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.19 (2026-08-26)
//
// v0.19 changes (2026-08-26) — Bulk multi-record EDIT alongside bulk delete:
//   - The bulk action bar (Received, Issued, Commodity Received/Issued,
//     Work Logs) now has an "✏️ Edit Selected" button next to Delete.
//   - Opens a small field-picker modal per table (Date, Condition/Status,
//     Payment Status where applicable). Only ticked fields are applied to
//     every selected record — unticked fields are left untouched.
//   - Reuses the same admin-password gate and edit-window lock as single
//     edits, and writes one EDIT audit-log entry per affected record.
//   - Staff Work Logs also blocks bulk-editing any selected active/open
//     shift until it's clocked out.
//
// v0.18 changes (2026-08-26) — Bulk multi-select delete for entry tables:
//   - Added checkbox column (Admin only) to Received, Issued, Commodity
//     Received/Issued, and Work Log tables. A "Select All" checkbox sits
//     in the header; a floating action bar shows the selected count with
//     Delete Selected / Cancel buttons.
//   - Bulk delete reuses each table's existing safety rules: records
//     outside the edit window can't be selected, one admin-password
//     confirmation covers the whole batch, and every deleted record is
//     still written to the audit log individually.
//   - Selections are cleared automatically on every re-render (tab switch,
//     data sync, period change) so bulk deletes can never target a stale
//     row set.
//
// v0.10 changes (2026-08-25) — Time range added to Work History by Role:
//   - The Role History modal (Staff → Role History) now has its own
//     Daily/Weekly/Monthly/Yearly/All/Range period selector, reusing the
//     same filterPeriod/pBtns pattern as the rest of the app.
//   - Defaults to "All" so existing behaviour (everything, unfiltered) is
//     unchanged until the admin picks a narrower range.
//
// v0.9 changes (2026-08-25) — Login History now visible to Admin for every
// account, not just their own:
//   - Non-admin accounts still see only their own last 3 sessions.
//   - Admin's "Login History" card now lists every account on the depot,
//     each with its own last 3 sessions (timestamp + IP), so Admin can spot
//     an unfamiliar sign-in on ANY account, not just their own.
//
// v0.8 changes (2026-08-25) — Login History in Settings → Account & Security:
//   - Every sign-in (password, fingerprint, or silent "Stay Signed In"
//     restore) now records a session entry: timestamp + the IP address it
//     came from (via api.ipify.org, added to CSP connect-src). Recorded
//     fire-and-forget right after login so a slow/blocked IP lookup never
//     delays sign-in.
//   - New "Login History" card shows each account's own last 3 sessions —
//     nothing is shown across accounts. Read-only, so an unfamiliar sign-in
//     is easy to spot; no delete/clear control.
//
// v0.7 changes (2026-08-24) — Depot Assistant can now bulk-edit log quantities:
//   - New AI_ACTIONS tool bulk_edit_log_quantity — e.g. "edit 20 August
//     stacking logs to 77 bags each". Previously the Assistant could only
//     bulk-move dates or bulk-delete work logs, so a quantity change request
//     like this got refused with "I don't have a tool for that."
//   - Matches logs the same way bulk_edit_log_date does (date required,
//     optional task/staff filters, same 24h-edit-window gate, Admin-only,
//     admin-password-confirm before executing).
//   - Recalculates earnings per log using getEarnings() — same formula the
//     manual "Edit Work Log" modal's saveEditLog() uses — so each log prices
//     off its OWN task rate, not a single assumed rate across the batch.
//     rateUnit/bags are recomputed the same way too, in case a task's rate
//     unit changed since the log was created. The confirmation preview shows
//     the new total gross earnings so Admin can sanity-check before saving.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.6 (2026-08-24)
//
// v0.6 changes (2026-08-24) — Depot Assistant input: Enter now makes a new line:
//   - cop-input was a single-line <input> where Enter immediately sent the
//     message. It's now a multi-line, auto-growing <textarea> (up to ~120px
//     tall, then scrolls) — Enter inserts a line break instead.
//   - To send: tap Send, or Ctrl+Enter (⌘+Enter on Mac) as a keyboard
//     shortcut. Hint text added under the input to make this discoverable.
//   - editCopilotMsg() (Edit & resend on your own messages) now also resizes
//     the textarea to fit the restored text.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.5 (2026-08-24)
//
// v0.5 changes (2026-08-24) — Depot Assistant now has real conversation memory:
//   - Previously every chat question was answered in isolation — only that
//     single question plus the current depot data was sent to the model, so
//     follow-ups like "what about last week?" or "and for John Banda?" had
//     nothing to resolve against.
//   - askCopilot() now snapshots the last COPILOT_CONTEXT_TURNS (12) chat-log
//     entries and sends them as a short "Recent conversation so far"
//     transcript ahead of the new question on every call. The depot JSON
//     stays the current live snapshot regardless — the system prompt tells
//     the model to trust the JSON over the transcript if the two conflict.
//   - Reconciliation mode is unaffected (still a single-shot analysis job,
//     no conversation transcript sent).
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.4 (2026-08-24)
//
// v0.4 changes (2026-08-24) — Depot Assistant chat log capped at 50:
//   - The on-screen Depot Assistant chat log now keeps only the most recent
//     50 entries — older turns drop off the top as new ones come in, instead
//     of growing unbounded for the rest of the session.
//   - Purely a display/memory cap: each request to the Assistant was already
//     stateless (full depot context + the single question, no prior chat
//     history sent), so this doesn't change what the Assistant sees or answers.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v0.3 (2026-08-24)
//
// v0.3 changes (2026-08-24) — Depot Assistant message actions + longer edit windows:
//   - Depot Assistant chat: each message now has an action row under it —
//     assistant replies get Copy + Share (native share sheet, falls back to
//     clipboard copy), your own messages get Copy + Edit (drops the text
//     back into the input box to tweak and resend).
//   - Settings → Staff & Records Policy: Record Edit Window and Staff
//     Records Edit Window dropdowns now offer 7 days and 10 days in
//     addition to the existing 6h/12h/24h/48h/72h options.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v100 (2026-08-23)
//
// v100 changes (2026-08-23) — Role Work History: show tasks with no logs:
//   - A task under a role (e.g. "Loader" under the Loading role) with zero
//     logged entries so far was silently dropped from its role's Role
//     History section — admins had no way to see it existed as a defined
//     sub-role until someone logged work under it.
//   - Every task defined on a role now always shows as its own sub-role
//     section, even with zero entries — it just shows "No entries logged
//     under this task yet." when expanded, instead of not appearing at all.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v99 (2026-08-23)
//
// v99 changes (2026-08-23) — Role Work History: nest tasks as sub-roles:
//   - A role can define more than one task at different pay rates (e.g.
//     role "Loading" → tasks "Loader" @K1.70/bag and "Stacking"
//     @K0.90/bag). The Role History report previously merged every task
//     under a role into one combined role-level total, with per-task
//     figures only visible as a flat BY TASK list inside.
//   - Each task under a role is now its own separate sub-role accordion,
//     nested inside the parent role's section, with its own independent
//     BY STAFF, BY DATE, and RECENT ENTRIES breakdown — fully separate
//     from other tasks under the same role rather than folded together.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v98 (2026-08-23)
//
// v98 changes (2026-08-23) — Job Role(s) picker: flat list:
//   - "Job Role(s)" in Register Staff and Edit Staff Details was a
//     flex-wrapped grid of checkbox pills, which gets cramped and hard to
//     scan once several roles are defined (e.g. splitting a combined
//     "Loading" role into separate Loading and Stacking roles). Both
//     pickers now render as a plain flat vertical list — one role per
//     full-width row — instead of wrapped pills. No change to the
//     underlying multi-role selection logic, just the layout.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v97 (2026-08-23)
//
// v97 changes (2026-08-23) — Role Work History: accordion + by-date:
//   - Each role in the "📋 Role History" report (Staff tab) is now its own
//     collapsed accordion section — tap a role's header to expand/collapse
//     it, instead of every role's full breakdown being shown at once in one
//     long combined scroll.
//   - Added a BY DATE breakdown inside each role section: combined totals
//     (entries, quantity, net) per calendar date across all staff logged
//     under that role. Deliberately excludes staff names — it's a pure
//     day-by-day activity total, unlike BY STAFF / RECENT ENTRIES.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v96 (2026-08-23)
//
// v96 changes (2026-08-23) — Combined Role Work History (admin):
//   - Added a "📋 Role History" button to the Staff tab (admin only) that
//     opens a company-wide report grouping every staff member's work log
//     entries by job role (sub-role) instead of by individual staff member.
//     Each role section shows total entries/quantity/net, a per-staff
//     contribution breakdown within that role, a per-task breakdown, and
//     the 10 most recent entries across all staff for that role.
//   - This is separate from the existing per-role section inside an
//     individual staff member's own profile, which only covers that one
//     person's logs across their assigned roles.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v95 (2026-08-19)
//
// v95 changes (2026-08-19) — Hamburger menu + Global Search role scoping:
//   - The hamburger menu showed every row to every role — General
//     Inventory, Commodities, Books, Contacts, Reports & Records (P&L/Cash
//     Flow/Budget), Audit Log, Setup Checklist, Today at a Glance
//     company-wide stats, and Cloud Sync management — even to a Staff login
//     that's view-only and self-scoped everywhere else (showTab() already
//     bounces it back to Dashboard via STAFF_BLOCKED_TABS, and Audit
//     Log/Setup Checklist already refuse non-admins). Tapping those rows
//     just produced a bounce or a refusal alert — confusing dead rows.
//   - Menu rows now hide per-role to match what each account can actually
//     do: Staff no longer sees any of the rows above; Manager/Admin are
//     unaffected except Audit Log and Setup Checklist, which now show for
//     Admin only (matching their existing requireAdmin()/role checks).
//     Synced on login and every time the menu opens, so switching accounts
//     on one device always reflects the current role.
//   - Bigger fix: Global Search (_doGlobalSearch) searched the FULL depot
//     — every staff member, all commodities, all contacts, all General
//     Inventory — regardless of role. This was a real side-door around the
//     Staff role's self-only scoping (same class of bug as the v93/v94
//     Depot Assistant fixes): a Staff login could search for and read
//     anyone else's records even though every tab that data lives on is
//     blocked for that role. Staff logins now only ever search their own
//     staff profile and their own logs; General Inventory, Commodities,
//     and Contacts sections are skipped entirely for that role.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v94 (2026-08-19)
//
// v94 changes (2026-08-19) — Depot Assistant full role scoping:
//   - v93 only fixed account/user-roster leakage. The Assistant still handed
//     a Staff-role login (view-only everywhere else in the app) the FULL
//     depot dataset — every staff member's logs and pay, all inventory,
//     commodities, and financials — plus every data-entry tool (clock
//     in/out, log commodity moves, log payments, etc.), none of which a
//     Staff login can touch anywhere else in the UI.
//   - buildCopilotContext() now branches on role: a Staff login gets ONLY
//     its own linked staff profile, own logs/pay/warnings/leave/attendance
//     (mirrors renderStaffDash's existing self-only scope) — no other staff,
//     no inventory, no commodities, no financials exist in that payload at
//     all. Admin/Manager keep the full operational dataset as before.
//   - Data-entry tools are no longer sent to the model for a Staff login,
//     and _handleAIActionCall() independently refuses to resolve/execute any
//     tool call for that role even if one somehow arrives — belt and
//     suspenders, so no code path can let a view-only account write data
//     through chat.
//   - System prompts updated to explain the new "accessScope" field so the
//     model states plainly it doesn't have other accounts'/staff's data
//     instead of guessing.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v93 (2026-08-19)
//
// v93 changes (2026-08-19) — Depot Assistant account isolation:
//   - Fix: Depot Assistant's context payload sent the FULL user roster
//     (every account's recovery email, phone, linked staff member, role) to
//     whichever account was chatting, regardless of that account's own role.
//     A Staff or Data Entry login could ask "about my account" and get every
//     other account's details.
//   - Now the Assistant is only ever given a single "myAccount" object — the
//     record for the account actually chatting. No other account's data is
//     ever included, admin included; system prompts updated so the model
//     explains it can't see other accounts if asked.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v89 (2026-08-18)
//
// v89 changes (2026-08-18) — Manager/Staff role tiers + self clock-in:
//   - New "Staff" role (in addition to Admin and Manager/Data Entry): a
//     genuinely view-only tier — dashboards, own password, own earnings —
//     that cannot add or edit any records.
//   - Staff logins can now be linked to a specific Staff Profile and clock
//     THEMSELVES in only (no picking another staff member); clocking out
//     stays Admin-only as before.
//   - Self clock-ins by Staff go through the existing pending-approval
//     workflow; that Pending Approvals review is now visible to Managers
//     too, not just Admin.
//   - Login screen now has an on-screen "← Back" button to landing (was
//     missing; hardware back already worked, this adds the visible one).
//   - New "Create Login" shortcut on each staff profile card, pre-filling
//     role=Staff and the linked staff profile.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v81 (2026-08-12)
//
// v81 changes (2026-08-12) — Books editor action bar moved to top:
//   - Save / Download / Print PDF were large full-width buttons pinned to
//     the bottom of the Books editor (easy to lose behind the mobile
//     keyboard, and took up a lot of vertical space). Moved into a compact
//     row directly under the title bar instead, using the small button
//     style — same actions, same ids, just relocated and shrunk.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v80 (2026-08-12)
//
// v80 changes (2026-08-12) — Books pagination + global search navigation fix:
//   - Books (Word docs): editor now shows visible A4-style page breaks as you
//     type instead of one endless block, plus a live "N pages" badge in the
//     header. No actual size cap existed before or after — this was a visual
//     fix so long documents don't feel capped at one page.
//   - Books (Spreadsheets): new "🖨 Print PDF" button exports the grid as a
//     paginated multi-page PDF via the existing print engine, alongside the
//     existing CSV download. Grid itself was already uncapped.
//   - Fix: global search results for Staff, Staff Logs, and Contacts only
//     ever navigated to the parent tab (e.g. tapping a staff member's log
//     just opened the Staff list) instead of opening that specific record.
//     Staff/Staff Log hits now open the matching staff member's profile
//     directly; Contact hits now open that contact's card directly.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v79 (2026-08-07)
//
// v77 changes (2026-08-07) — Install App button:
//   - Settings → Help & Documentation now has an "Install on This Phone" card
//     with a real Install App button, wired to the browser's beforeinstallprompt
//     event (captured in index.html, replayed via .prompt() on tap). Previously
//     the manifest/SW/icons were all in place for installability, but nothing
//     in the UI ever triggered the actual install dialog — users had to
//     discover their browser's own install icon/menu entry on their own.
//   - Button auto-hides once already installed (display-mode: standalone/
//     fullscreen, or iOS's navigator.standalone) or before the browser has
//     signalled the app is installable, with a note explaining how to install
//     manually as a fallback (e.g. iOS Safari, which never fires the event).
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v76 (2026-08-06)
//
// v76 changes (2026-08-06) — Depot Assistant proxy fix + graceful overload handling:
//   - Fix: mdm-copilot-proxy Cloudflare Worker was serving stale "Hello
//     World" stub code (never actually deployed with the real proxy logic),
//     and the GEMINI_API_KEY secret had been lost during a Worker
//     deployment-source change. Both root causes together were producing
//     "Failed to fetch" and then HTTP 401 errors in Depot Assistant.
//     Re-deployed the correct worker.js and re-added the secret directly
//     in the Cloudflare dashboard — key itself was never exposed in
//     index.html or chat.
//   - New: _callCopilot now retries once automatically (after a 2s delay)
//     on transient Gemini overload responses (429/500/503) before
//     surfacing any error to the user — most "high demand" spikes now
//     resolve silently.
//   - New: when an error is shown, it now parses the JSON error body and
//     displays the human-readable message field (e.g. "gemini-3.5-flash
//     is currently experiencing high demand...") instead of raw, often
//     truncated JSON.
//
// v75 changes (2026-08-03) — Depot Assistant auth fix + action support:
//   - Fix: Gemini Interactions API calls were sending GEMINI_API_KEY via the
//     x-goog-api-key header, which was intermittently rejected (401
//     "Expected OAuth 2 access token...") with this account's AQ.-format
//     key — while the same key worked fine via a ?key= query param in
//     another app on this same account. Switched to sending the key as a
//     query param as the primary method, with the header kept only as a
//     one-time fallback if that somehow 401s too.
//   - Fix: chat/reconciliation requests could abort with a raw
//     "signal is aborted without reason" browser message on slower mobile
//     connections. Timeout raised to a flat 45s for both modes, and abort
//     errors now show a clear "Request timed out — check your connection
//     and try again" message instead.
//   - Regular chat questions now send a trimmed context (most recent ~150
//     entries per log-style array — staff logs, warnings, payments, leave,
//     attendance, movements, transport, close-outs, audit log) instead of
//     the full dataset, for faster responses over mobile data.
//     Reconciliation still gets the complete, untrimmed dataset.
//   - New: Depot Assistant can propose clocking a staff member in via a
//     clock_in_staff tool call, but only ever as a Confirm/Cancel action in
//     the chat — nothing is written until the user taps Confirm. Reuses the
//     same stampEntry()/logAuditEvent()/updateData() path as the manual
//     Clock In form, so pending-approval workflow and the audit trail
//     behave identically; audit entries are tagged "via Depot Assistant".
//     Reconciliation mode has no tool access — read-only analysis only.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v74 changes (2026-08-03) — stale-shell fix + login hardening:
//   - Navigate fetch now uses { cache: 'no-store' } instead of a plain
//     fetch(). "Network-first" only helps if the request actually reaches
//     the network — a plain fetch() still honors normal HTTP caching, so a
//     host sending cache-control headers on index.html could hand back a
//     stale response even though the SW "tried the network first". This
//     was likely why login fixes shipped in index.html weren't reaching
//     devices on redeploy without a manual cache clear.
//   - index.html: fbAuthSignIn/fbAuthSignUp now wrapped in the same
//     10s-timeout pattern as fbGet/fbSet, so a stalled Firebase Auth SDK
//     call can no longer hang doLogin() on "Verifying…" forever.
//   - index.html: doLogin() same-depot restore path now forces one
//     unconditional cloud re-fetch/merge if the usernames/ index confirms
//     an account belongs to this depot but it's still missing locally
//     after the normal version-gated restore — fixes sub-user accounts
//     that silently could never log in on a given device.
//
// Current version: v73 (2026-08-02)
//
// v73 changes (2026-08-02) — rate-change security, Depot Assistant (Gemini), OT fix:
//   - Security: changing a staff task's pay rate, rate unit, or custom unit
//     in Roles & Rates now requires the admin password confirmation modal
//     (requireAdminPassword), not just admin role — matching every other
//     destructive/sensitive admin action in the app.
//   - Depot Copilot replaced with Depot Assistant, powered by Gemini instead
//     of the Cloudflare Worker + Anthropic proxy. Calls Google's Gemini API
//     directly from the browser via the Interactions API (generativelanguage.
//     googleapis.com/v1beta/interactions) using a client-side GEMINI_API_KEY.
//     Now has full data access (staff, commodities, stock movements,
//     payments, attendance, transport, budgets, audit log) rather than a
//     capped/summarized snapshot — excluding password hashes and the
//     recovery PIN, which never leave the device. CSP connect-src updated
//     to allow generativelanguage.googleapis.com; the old worker-subdomain
//     placeholder origin removed.
//   - Fix: Overtime multiplier dropdown (Log Task and Complete Shift forms)
//     defaulted to "× 1.5 — Time & a half" selected in the HTML, so gross
//     pay was multiplied by 1.5 even when the OT section was hidden and no
//     actual overtime had been detected from time in/out (e.g. both fields
//     left blank). Default changed to "× 1.0 — No extra OT pay", and the
//     dropdown now explicitly resets to 1 whenever the calculated hours no
//     longer exceed the depot's Standard Shift Hours setting.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v72 changes (2026-07-28) — signup ordering fix for Phase 4 readiness:
//   - Reordered admin signup: Firebase Auth account creation + Phase 3's
//     authorizedUids grant now happen BEFORE the depots/{id}/auth write,
//     not after. Previously the depots write went out unauthenticated
//     (before any UID existed for that depot), which works fine against
//     open rules but would reject every new signup once Phase 4's depots
//     rule requires auth.uid ∈ authorizedUids. No behavior change while
//     depots stays open — this only matters once that rule ships.
//
// v71 changes (2026-07-28) — Phase 3 & 5: ownership records + admin auth:
//   - Phase 3: new _grantAuthorizedUid(installId, uid) writes
//     depots/{installId}/authorizedUids/{uid}: true whenever a UID is
//     confirmed for a depot — at signup, sub-user creation, and both
//     login-time migration paths (already-Auth-confirmed backfill, and
//     silent migration on legacy-verified login). This is the record
//     Phase 4's tightened depots rule will check against once published;
//     it does nothing on its own until that rule ships.
//   - Phase 5 (mdm-admin.html only, not index.html, but versioned together
//     since they deploy as one release): admin panel login now goes through
//     real Firebase Auth (signInWithEmailAndPassword) instead of a
//     client-side SHA-256 password comparison. Every fbGet/fbPatch/fbDelete
//     in the admin panel now attaches the operator's ID token the same way
//     index.html's v70 change did for the main app.
//   - No rules changes shipped with this version — licenses and
//     subscriptionRequests operator-gating rules are published separately
//     once the admin panel above is confirmed working with the new login.
//   - depots deliberately NOT gated in this version — still open. Gating it
//     now would strand any account that hasn't completed the Phase 1 login
//     migration yet, since an unmigrated account has no auth.uid at all
//     during its own legacy-verification read. Held until migration
//     coverage is confirmed near-total.
//
// v70 changes (2026-07-27) — Phase 2: authenticated RTDB requests:
//   - fbAuthSignUp/fbAuthSignIn now go through the Firebase Auth SDK (loaded
//     via CDN — firebase-app-compat.js + firebase-auth-compat.js, deferred —
//     see index.html <head>) instead of hand-rolled Identity Toolkit REST
//     calls. The SDK persists the session and refreshes ID tokens silently
//     in the background (they expire hourly), which is what this phase
//     needed — reimplementing that with raw refresh-token REST calls would
//     just be a worse version of what the SDK already does.
//   - Every fbGet/fbSet/fbSetIfNotExists/fbDelete call now attaches
//     ?auth=<idToken> when a Firebase Auth session exists (_getIdToken()).
//     No rules changed yet, so this doesn't restrict anything on its own —
//     it just means requests are *carrying* proof of identity, ready for
//     Phase 4 to actually require it. A request with no Auth session (not
//     yet migrated, or the SDK failed to load) simply goes out
//     unauthenticated, exactly as every request did before this phase.
//   - Realtime Database and App Check both stay on the existing REST API —
//     only Auth itself moved to the SDK.
//   - Logout (_doLogoutNow) now also clears the Auth SDK session
//     (fbAuthSignOutSilently), so no stale token lingers into the next login
//     on a shared device.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v69 changes (2026-07-27) — Phase 1: Firebase Auth migration:
//   - Real Firebase Authentication accounts now exist alongside the legacy
//     username/password-hash system, as the first step of migrating off the
//     current "no auth, public rules" Firebase security model.
//   - New signups (signupFinish) and admin-added sub-users (_confirmAddUser)
//     provision a real Firebase Auth account (synthetic email
//     {username}@mdm-depot.internal) immediately alongside the existing
//     password hash.
//   - Existing accounts migrate silently on their next successful login:
//     doLogin() tries Firebase Auth first, and on any failure (not-yet-
//     migrated, or a stale Auth password — see below) falls back to the
//     existing hash check exactly as before, then provisions/repairs the
//     Auth account using the plaintext password the user just typed.
//   - Any password reset that happens without the old password (email/PIN
//     recovery, admin reset, Settings > My Account change) now flags
//     authMigrated:false, since it can't push the new password to Firebase
//     Auth from the client — that needs either the old password or a
//     privileged server-side call. Login is unaffected either way (Auth
//     failures always fall back to the legacy check); fully closing this
//     gap is a Phase 5 (server-side) follow-up.
//   - No database rules changed yet — this phase only builds the dual-path
//     login system rules will eventually depend on (Phase 4).
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v68 changes (2026-07-27) — Staff Date of Birth:
//   - Added optional Date of Birth field to Register Staff and Edit Staff
//     Details forms, shown on the staff profile card, and included as a
//     column in the Staff Roster CSV export.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v67 changes (2026-07-09) — Crash fix (Staff tab blank/Display Error):
//   - ROOT CAUSE: in renderStaffLogs(), the per-staff cumulative running-
//     total map (cumMap) was rebuilt from approved entries only (v61
//     approval workflow). But the fallback used when a log had no entry
//     in that map — i.e. any PENDING log — was `{cumBags:0,cumNet:0}`,
//     while the render code actually reads `cum.cumQty` and `cum.cumUnit`.
//     Neither key existed on the fallback, so `cum.cumQty.toLocaleString()`
//     threw "Cannot read properties of undefined (reading 'toLocaleString')"
//     the moment any pending staff log existed — blanking the Staff tab
//     (and, via the app shell/SW interaction, sometimes the whole page).
//   - FIX: fallback corrected to `{cumQty:0,cumNet:0,cumUnit:''}` to match
//     what's actually read.
//   - Audited all other cumulative maps (general/commodity received &
//     issued) for the same class of bug — none found; their fallbacks are
//     plain `||0` against numbers, which is safe.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v63 changes (2026-07-09) — License activation not being picked up:
//   - ROOT CAUSE: checkLicense() only ever ran at the 3 login call-sites
//     (password login, quick/biometric login, session auto-restore). A
//     device that stayed logged in never re-fetched /licenses/{depotKey},
//     so activating/upgrading a customer in Firebase while their app was
//     already open went unnoticed until they fully logged out and back in.
//   - FIX 1: added a 🔄 refresh control on the trial/subscription banner
//     and on Settings → License & Connection, which calls checkLicense()
//     immediately and toasts the result (still trial / now active / etc).
//   - FIX 2: added a throttled automatic re-check (at most once every 5
//     min) on `visibilitychange`, so simply switching back to the app
//     after paying picks up the change without any manual action.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v62 changes (2026-07-09) — Approval workflow fixes:
//   - FIX: a rejected clock-in was still showing a green "🟢 ACTIVE" badge
//     and offering admin a "Clock Out" button, contradicting the REJECTED
//     badge. A rejected staff log is no longer treated as an active shift.
//   - FIX: rejection reason was only in a hover `title` attribute, invisible
//     on mobile (no hover). It's now shown as visible text under the
//     ❌ REJECTED badge on every list (received/issued/stock counts/
//     transport/staff logs/payments/leave), for staff and admin alike.
//   - FIX: the Pending Approvals modal kept showing already-actioned
//     entries until manually closed and reopened. Approve/Reject now
//     refreshes the list in place immediately.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v61 changes (2026-07-09) — Entry Approval Workflow:
//   - NEW: every entry created by a non-admin (staff/data-entry) account —
//     general received/issued, general stock counts, commodity
//     received/issued/stock counts, transport log, staff clock-in/work log,
//     staff payments, and leave/absence entries — is now stamped 'pending'
//     instead of joining official company data immediately.
//   - Pending entries still show in the account that created them (and to
//     admin) with a ⏳ PENDING badge, but are excluded from every balance,
//     stock-availability, sales, credit/debt, payroll, P&L and Cash Flow
//     calculation until approved.
//   - Admin gets a "Pending Approvals" screen (banner on Dashboard when
//     items are waiting → openPendingApprovalsModal()) to Approve or
//     Reject each entry, with an optional rejection reason shown to the
//     staff member (❌ REJECTED badge).
//   - Admin-created entries are approved immediately — no change to admin
//     workflow.
//   - Edits to existing records were already admin-only before this change
//     and remain so; this release only affects newly created entries.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v60 changes (2026-07-08):
//   - Cleanup: removed a dead `waMsg` per-tier WhatsApp message builder in
//     renderPaymentSection() (Settings → My Plan). It was leftover from
//     before the in-app "Apply to Upgrade" flow existed and was never
//     referenced — buttons already open openSubscriptionForm(), which
//     submits structured data straight to subscriptionRequests/ for the
//     admin panel. No behavior change; just removes confusing dead code.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v59 changes (2026-07-08):
//   - Fix: Settings → My Plan wrongly marked the Pro card as your "CURRENT"
//     plan while on trial (since trial grants pro-equivalent feature access),
//     which hid the "Apply to Upgrade" button — leaving no way to actually
//     apply for Pro during the trial. renderPaymentSection() now only treats
//     a tier as current when there's a real paid subscription (status
//     'active' or 'expired_grace'); trial/free/expired show no tier as
//     current, so Starter, Growth, and Pro all keep their upgrade buttons.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v58 changes (2026-07-08):
//   - Fix: "Clear all data" (Settings → Danger Zone) wiped local data but
//     never pushed the change to the cloud — unlike every other delete in
//     the app, it didn't call scheduleFbSync(). The old data could sit in
//     Firebase until the next 5-minute periodic sync or a manual "Upload to
//     Cloud" tap, and another logged-in account could even pull the stale
//     un-cleared data back down in the meantime. clearAll() now pushes
//     immediately, same as every individual record delete.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v57 changes (2026-07-08):
//   - Fix: multi-account Firebase sync used _v (a per-device local edit
//     counter) to decide which copy of the data was "newer". Since each
//     device/account increments its own _v independently, a device with more
//     historical edits could show a higher _v than a device holding the
//     actual most recent change — so deletes and other edits made from a
//     data-entry account (e.g. sdc1, sdc2) could be silently discarded by
//     other logged-in accounts, or even overwritten back into the cloud.
//     Sync now stamps every write with a Firebase SERVER timestamp
//     (_syncTs) and compares against that shared clock instead. Falls back
//     to the old _v comparison only once, for cloud data written before
//     this fix shipped.
//   - Added a 60-second background pull while a session is open (previously
//     the app only pulled from the cloud at login and pushed every 5
//     minutes, so an already-logged-in account could go a long time without
//     seeing another account's changes). Skipped automatically while a
//     modal is open so it never interrupts active data entry.
//   - Non-admin (data-entry/staff) accounts now get their own Settings tab
//     — previously hidden from them entirely. Scoped to only what's
//     relevant for them: display preferences, dashboard widgets,
//     fingerprint login, stay-signed-in, their own password, help/legal —
//     not company-wide, billing, or destructive admin controls.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v56 changes (2026-07-05):
//   - Added Depot Copilot: Pro-tier AI assistant (🤖 FAB) for stock/staff
//     Q&A and a Fable-5-powered end-of-day/period reconciliation, proxied
//     through a new Cloudflare Worker (depot-copilot-worker.js) so the
//     Anthropic API key never lives in client code. CSP connect-src
//     extended to allow the worker origin once deployed. No sw.js cache
//     logic changes — bump only, so the new index.html JS is fetched
//     instead of served from the old cached shell.
//
// v55 changes (2026-07-03):
//   - Fix: clicking anything that re-rendered the current tab (adding,
//     editing, or deleting a record) reset scroll position to the top of
//     the page. render() now preserves scroll across data-driven re-renders
//     and only jumps to top on an actual tab switch (showTab).
//   - Added fixed monthly salary support for staff, alongside the existing
//     task/rate-based pay. New Pay Type field (+ Monthly Salary amount) in
//     Register Staff and Edit Staff Details. Salaried staff can still clock
//     in/out for attendance without accruing task-rate earnings. Payslips
//     for salaried staff use the fixed monthly amount, prorated for partial
//     months (joined/left mid-month); deductions still apply as before.
//     P&L and Cash Flow now include prorated salaried-staff cost for the
//     selected period. Staff tab's Earnings and Roster views show a SALARY
//     badge and the monthly amount instead of a misleading K0.
//
// v54 changes (2026-06-30):
//   - Branding in all prints: company logo and brand colour now appear on
//     every print surface (sale receipts, payslips, period summary, audit
//     log, CSV/data exports, books PDF, staff ID cards). New
//     _getBrandedHeader() helper reads di.logoDataUrl and di.brandColor;
//     shows logo image if uploaded, else a coloured initials box. CSS var
//     --accent injected into _pdfPrint() so table accents, borders, and
//     highlights all follow the depot's colour. Feature gate removed from
//     ID card print — stored logo/colour always prints regardless of tier.
//   - Sales tab gated to Pro plan. Free/Starter/Growth users see a lock
//     screen with upgrade prompt. daily_sales added to TIER_FEATURES.pro.
//     Sales tab button shows 🔒 for non-pro tiers.
//   - Inline "＋ New Customer" in issue form. Tapping the link opens a
//     name + phone panel inside the modal; "✓ Save & Select Customer"
//     creates the contact in DATA.contacts, logs to audit trail, and
//     auto-selects the new customer in the dropdown — no form re-open
//     needed. Duplicate names reuse the existing contact instead.
//
// v53 changes (2026-06-28):
//   - Payment details: Airtel Money number changed to +260 977 638 790 in the
//     subscription application form, the upgrade prompt screen, and the
//     copy-to-clipboard value. MTN MoMo number unchanged.
//   - Trading name updated: payment method labels ("MDM Developer" →
//     "Spike Trading and General Dealers"), Terms of Service (§1 Acceptance,
//     §7 Intellectual Property), Privacy Policy (§1 Who We Are), and both
//     modal footer copyright lines now read NEXLITE-DIGITAL-SOLUTIONS-LIMITED
//     (trading as Spike Trading and General Dealers) in place of
//     "Digital Frontier Technologies". Legal entity name unchanged.
//
// v52 changes (2026-06-28):
//   - Fix: Sales tab button not responding to taps. 'sales' was missing from
//     the gtab listener array in attachTabListeners(), so no click handler was
//     ever registered for #gtab-sales. Added 'sales' between 'issued' and
//     'stockcount' in the forEach list.
//   - Admin panel: subscription applications now received and actionable.
//     MDM app writes to subscriptionRequests/<installId>/<timestamp> but the
//     admin panel only read licenses/ — applications were silently lost.
//     Admin now loads subscriptionRequests/ in parallel with licenses/ on
//     every refresh. A "📋 Subscription Applications" section (with pulsing
//     badge count) appears above the depot list whenever pending requests
//     exist. Each card shows depot name, phone (tap-to-call), payment method,
//     transaction ID, and submission time, with three action buttons:
//     → Trial (sets status:trial), → Active (sets status:active with correct
//     tier + 30-day activeUntil), ✕ Dismiss (marks request dismissed without
//     touching the license). Field mapping fixed: MDM sends `phone`, admin
//     now reads phone || contactPhone when writing to licenses/.
//     Firebase rules note added to admin config block — subscriptionRequests
//     node must allow unauthenticated read/write per $installId.
//
// v51 changes (2026-06-28):
//   - Font stack updated: DM Sans → IBM Plex Sans, DM Mono → IBM Plex Mono.
//     Provides a more authoritative financial/data-entry feel throughout the app.
//     Syne (headings) retained. FONTS_CSS updated to match new Google Fonts URL.
//   - Customer linking: sales/issue transactions now accept an optional customer
//     from DATA.contacts (type=customer). customerId + customerName stored on
//     each generalIssued record. Customer column added to Issued and Daily Sales
//     tables. Customer name appears on printed receipts. Contacts tab customer
//     cards gain a 🧾 History button showing all linked transactions, total
//     spend, and outstanding credit. Debtor card shows customer name inline.
//     Cache bump only for sw.js — no SW logic changes.
//
// v50 changes (2026-06-24):
//   - Fix: when "Stay Signed In" is enabled on a device, inactivity
//     auto-logout is now fully disabled. _idleReset() returns early and
//     clears any pending timers if _checkStaySignedIn() returns a valid
//     session. The user is only logged out by an explicit Sign Out action
//     or by disabling the "Stay Signed In" toggle. The Settings card
//     description is updated to reflect this behaviour.
//   - Cache version bump to align sw.js with index.html v49 deploy.
//
// v49 changes (2026-06-21):
//   - Median appConfig hardened: keepScreenOn, portrait lock, PDF/CSV
//     downloads to public storage, tel/mailto/wa.me external routing,
//     pull-to-refresh disabled, Android hardware back confirm-exit,
//     allowInsecure:false, androidWebviewTextZoom:100.
//     No sw.js logic changes; cache bump only.
//
// v48 changes (2026-06-21):
//   - Fix: login delay (30+ seconds, spread evenly across steps). Root cause:
//     _getAppCheckToken() is called fresh before every single Firebase
//     request, and one login makes 5-6 sequential Firebase calls (lockout
//     check, username lookup, auth lookup, depot data restore, lockout
//     clear, post-login cloud restore). When the reCAPTCHA→App Check token
//     exchange is failing (it currently is — see Firebase Console App Check
//     metrics, 0% verified), each of those 5-6 calls independently re-paid
//     the full ~20s reCAPTCHA+exchange timeout before falling through to
//     "no token" and proceeding. Added a 30s negative cache: once the
//     exchange fails once, subsequent calls within that window return null
//     immediately instead of retrying, so only the first call in a login
//     pays the timeout cost. Does not fix the underlying App Check failure
//     itself (still being diagnosed via ?acdebug=1) — only bounds its cost.
//
// v47 changes (2026-06-21):
//   - New Settings → "Stay Signed In" toggle (off by default). Per-device,
//     opt-in: when on, skips the login screen on app relaunch for up to a
//     user-chosen number of days (7/14/30/60/90). Stores ONLY username +
//     expiry timestamp in localStorage — never a password or hash — so a
//     copied localStorage value can skip the login screen on that one
//     device only, never be replayed elsewhere or used to derive
//     credentials. Any explicit logout (button or remote cross-tab logout)
//     immediately revokes the persisted session; turning the toggle off
//     does the same. When "Stay Signed In" is active, inactivity
//     auto-logout is suppressed — the timers are not started so the user
//     is never kicked out involuntarily while the feature is enabled.
//
// v46 changes (2026-06-21):
//   - Cache version bump only (debug build for App Check diagnostics).
//
// v45 changes (2026-06-21):
//   - Security: login now verifies the password against a small new
//     depots/<id>/auth record (just username/passwordHash/role) BEFORE
//     fetching the full depot dataset. Previously the entire depot — every
//     commodity, staff record, transaction, and financial figure — was
//     downloaded as part of resolving the login, even on a wrong password.
//     The auth record is kept in sync automatically on every doFbSync() call
//     (derived from DATA.users) and written immediately at signup. Existing
//     depots self-migrate on their next sync; until then, login falls back
//     to the old full-data verification path with no behavior change.
//
// v44 changes (2026-06-21):
//   - Fix: login could hang forever with zero feedback on a slow/flaky
//     connection. _getAppCheckToken() (called before every Firebase request,
//     including the brute-force lockout check that runs first on login) had
//     no timeout on its reCAPTCHA promise or token-exchange fetch — both now
//     bounded to 10s and degrade gracefully like the rest of the Firebase
//     helpers. doLogin() also now validates the ToS checkbox and updates the
//     button to "Checking…" BEFORE making any network call, so a tap always
//     gives instant visual feedback instead of looking unresponsive.
//
// v43 changes (2026-06-21):
//   - Firebase App Check (reCAPTCHA v3) integrated. All Firebase REST calls
//     (fbGet, fbSet, fbSetIfNotExists, fbDelete) now attach an
//     X-Firebase-AppCheck token. Token is fetched from reCAPTCHA v3 and
//     exchanged via firebaseappcheck.googleapis.com, cached until near-expiry.
//     Degrades silently if reCAPTCHA hasn't loaded (offline start). CSP
//     updated to allow reCAPTCHA and App Check domains.
//
// v31 changes (2026-06-20):
//   - General-tab inventory item types now capped, in parallel with (but
//     independent from) the existing Commodity tab cap: Free = 1 item type,
//     Starter = 3, Growth+ = unlimited. Enforced at both entry points that
//     write to DATA.inventoryItems — the Manage Inventory Items modal and
//     the General tab's Item Names subtab — each swapping the add-form for
//     an upgrade card when the depot is at its limit.
//
// v30 changes (2026-06-20):
//   - Numeric tier caps now enforced (previously labels only). Free: 1 staff,
//     1 commodity type, 30-day visible history, contacts view-only (removed
//     contacts_edit from Free — was incorrectly granted before this release).
//     Starter: 5 staff, 3 commodity types, 90-day history, contacts editable
//     up to 50. Growth/Pro/Multi-Site remain unlimited on all four. Checked
//     at the point of creation (staff/commodity/contact add) with a
//     dedicated "limit reached" upgrade prompt, and at the point of display
//     for history (filterPeriod now clamps every period — including "All"
//     and custom date ranges — to the tier's visible-history window).
//
// v29 changes (2026-06-20):
//   - New Starter tier (K90/mo) inserted between Free and Growth in the
//     tiered licensing system. Same feature set as Free (no cloud sync,
//     exports, or reports) — raises numeric ceilings only: 5 staff profiles,
//     3 commodity types, 90-day visible history, edit up to 50 contacts.
//     Cap enforcement itself is not yet wired up; this release only adds
//     the tier to TIER_ORDER/TIER_META/_TIER_BULLETS and updates every
//     tier-aware UI surface (landing pricing ladder, upgrade modal, admin
//     payment panel, account status screen) to display and price it.
//   - Legal/identity update: Terms of Service, Privacy Policy, and the
//     Settings screen footer now name the NAPSA-registered company,
//     NEXLITE-DIGITAL-SOLUTIONS-LIMITED (trading as Digital Frontier
//     Technologies), as the operating entity in place of "MDM Developer."
//
// v28 changes (2026-06-12):
//   - Price per month updated from K100 to K300.
//   - Fix 13: Cross-tab logout synchronisation via BroadcastChannel (with
//     localStorage storage-event fallback for Safari <15.4). Logging out in
//     any tab now immediately logs out all other open tabs.
//   - Fix 14: SubtleCrypto (PBKDF2) fallback to mdm1 disabled for new
//     passwords. hashPassword now throws with a user-facing toast when
//     crypto.subtle.deriveBits is unavailable instead of silently falling
//     back to the weaker custom stretch algorithm. Legacy mdm1 hashes are
//     still accepted by verifyPassword for backward compatibility.
//
// v27 changes (2026-06-12):
//   - Fix 30: Dashboard Widget Customisation. New "Dashboard Widgets" section
//     in Settings lets users show/hide any of the 8 dashboard sections via
//     toggle switches: Alerts & Warnings, Quick Actions, Today Snapshot,
//     Commodities, Inventory Balances, Staff Summary, Recent Activity, Recent
//     Books. Preferences stored in localStorage (per-device, not cloud-synced).
//     All widgets default to on. "↺ Show All Widgets" reset button restores
//     all. Each toggle re-renders the dashboard instantly with a toast.
//
// v26 changes (2026-06-12):
//   - Fix 29: Staff ID Card Generator. "🪪 Print ID Card" button added to
//     every staff profile modal. Opens a print-ready pop-up with front and
//     back of a credit-card-sized ID card (85.6 × 54 mm). Front: initials
//     avatar, name, role, phone, date joined, location, colour-coded contract
//     type badge, employee ID, live status indicator. Back: emergency contact,
//     company info, employee ID in barcode style, authorised signature line.
//     Fully offline — pure HTML/CSS, no external dependencies.
//
// v25 changes (2026-06-12):
//   - Cloud upload/download icons on every nav tab. Two small SVG cloud
//     buttons per tab: ↑ Upload (doFbSync) and ↓ Download (version-gated
//     pull with confirm). Fade on hover; always visible on active tab;
//     45% opacity on inactive tabs on touch. Spins while syncing.
//   - Fix 27: First-Run Onboarding Checklist. 5-step modal auto-appears
//     after first admin login. Steps auto-check from live DATA state.
//     Navigates to relevant tab on tap. Permanently dismissible.
//     Re-openable from Settings → Help & Documentation.
//   - Fix 28: Inline ℹ️ Tooltips. mdmTip() helper with smart-positioned
//     singleton popup. 15 tooltips across key fields: Currency, Shift Hours,
//     Annual Leave, Edit Window, Auto-Logout, Recovery PIN, Purchase Price,
//     Selling Price, Batch Name, Deduction, Budget fields, and more.
//
// v24 changes (2026-06-11):
//   - Two-Stage Shift Log: "Log Work" button split into ⏵ Clock In and
//     ✏️ Manual. Clock In (Stage 1) saves an open shift with status:'open',
//     timeInTs, staff, role, task, date, time-in. Clock Out (Stage 2)
//     completes the shift: adds time-out, qty, earnings, deductions, notes,
//     sets status:'completed' + timeOutTs. Open shifts show a pulsing
//     🟢 ACTIVE badge and inline ⏹ Clock Out button in the logs table.
//     Active-shifts banner at top of logs lists all open shifts.
//     Duplicate open-shift guard blocks double clock-in with redirect to
//     Clock Out. Edit-window calculation now anchors to timeOutTs instead
//     of uid creation time for completed staff logs. Migration on load tags
//     all legacy logs as status:'completed' with timeOutTs from uid timestamp.
//   - Hotfix: missing `function openLogForm(){` declaration (eaten by str_replace
//     anchor) caused a parse-time SyntaxError → blank dark screen on load.
//
// v23 changes (2026-06-11):
//   - PC/tablet nav moved from left sidebar to bottom tab bar.
//     Tabs display icon + label side-by-side (row layout), 64px tall,
//     max 140px wide per tab, centred across full width. Active tab
//     retains green top-border indicator. Content area uses full screen
//     width with 28–40px horizontal padding. Book editor unlocked from
//     480px cap on PC. Extra-wide (≥1200px) breakpoint bumped to 68px
//     tab height and 40px content padding.
//
// v22 changes (2026-06-11):
//   - Light theme purified: all hardcoded dark hex backgrounds (#0a1628,
//     #001a2e, #002b1f, #081428, #0d1a40, #1a0d2e, #0d2a00, #2a1500,
//     #3d1515) replaced with CSS variables (var(--surface),
//     var(--overlay-dark-1), rgba tints). Screen gradients now use
//     var(--surface2). fs-mini, gsearch-overlay, pay-row, unp-row,
//     role badges, activity icons, error boxes and all JS-rendered cards
//     are theme-aware. Quick-action buttons get body.light tint classes.
//
// v21 changes (2026-06-11):
//   - Fix 23: Supplier picker added to General and Commodity receive forms.
//     supplierId + supplierName stored on every receive record; Supplier
//     Performance tab now auto-links without manual name matching.
//   - Fix 24: Vehicle / Transport Log added as new 🚛 Transport subtab inside
//     the Commodity tab. Fields: date, vehicle, driver, route, trip type,
//     cost, notes. Includes CSV export.
//   - Fix 25: Batch/lot traceability on commodity issues. Issue form shows
//     Source Receive Record dropdown (filtered by batch, shows date/qty/supplier).
//     sourceReceiveId stored on issue records. 🔍 Trace button on issue rows
//     opens a modal showing the full issue → receive chain with supplier details.
//
// v20 changes (2026-06-10):
//   - Fix 19: Credit/debt tracking on issue and receive records.
//     Issue form now captures payment status (paid/partial/credit) and
//     partial amount paid. Outstanding credit card shows all open debts.
//     Receive form captures supplier payment status (paid/partial/credit).
//   - Fix 20: Consolidated Profit & Loss view added as new P&L subtab
//     in the General tab. Shows revenue, COGS, gross profit, staff costs,
//     and net profit for the selected period, with a full COGS breakdown.
//
// v19 changes (2026-06-10):
//   - (index-4 release — see index.html changelog)
//
// v18 changes (2026-06-09):
//   - fbRestoreData now merges users instead of overwriting: cloud is
//     authoritative for users it knows, but local-only users (sub-users added
//     while offline or before sync caught up) are never dropped.
//
// v17 changes (2026-06-09):
//   - Any account from any depot can now log in on any device (no device binding).
//   - Pre-login restore always looks up username in Firebase usernames/ index first
//     to resolve the correct depot installId, then restores that depot's data.
//
// v16 changes (2026-06-09):
//   - Pre-login restore now always runs (not only when DATA.users is empty).
//   - On brand-new device/fresh install: looks up username in Firebase
//     usernames/ index to discover installId, then does a full depot restore.
//
// v15 changes (2026-06-09):
//   - Removed Depot Key as a recovery method entirely.
//   - Recovery is now PIN and email only.
//
// v14 changes (2026-06-09):
//   - Pre-login cloud restore when DATA.users is empty on fresh install.
//   - Better login error message when no local data exists on device.

// ────────────────────────────────────────────────────────────────────────────

const CACHE     = 'v0.3.149';   // ← bump this whenever you deploy a new version (x.y.z, each group 0-9 then rolls over)
const SHELL     = './';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@600;700;800&display=swap';

// ── HELPERS ──────────────────────────────────────────────────────────────────

// Strip _mv query param from a URL so cached entries are found regardless of
// whether the URL was stamped by the Median update check or not.
function stripMv(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('_mv');
    return u.toString();
  } catch (e) {
    return url;
  }
}

// Build a cache Request with the _mv param removed (used as the cache key).
function cacheKey(request) {
  const clean = stripMv(request.url);
  return clean === request.url ? request : new Request(clean, { mode: 'same-origin' });
}

function cacheFirst(req) {
  const key = cacheKey(req);
  return caches.match(key).then(cached => {
    // Serve cached immediately; revalidate in background (stale-while-revalidate)
    const revalidate = fetch(req).then(r => {
      if (r && r.ok) caches.open(CACHE).then(c => c.put(key, r.clone()));
      return r;
    }).catch(() => {});
    return cached || revalidate;
  });
}

// How long to wait for the network before answering from a cached copy (only when there is one).
const NET_WAIT_MS = 4000;
// How long a script may wait for the network when there is NO cached copy (v0.3.97). A <script src> blocks the page while it loads, so waiting for ever left
// the page stuck with no message. After this long the cache is checked once more and, if still empty, the script fails; the page's load guard then reloads
// once and shows a message naming the file. The download carries on in the background and fills the cache, so the retry usually finds it there.
const NET_HARD_MS = 10000;
// A page loads its files one after another (each <script src> blocks the next). If every cached file waited its own NET_WAIT_MS on a dead network, a start-up with
// six files took about 20 s (measured). So once the network has proven slow (a wait ran out and the cache answered), for the next NET_SLOW_MS cached files are
// answered after only NET_SLOW_WAIT_MS; the downloads still carry on in the background and refresh the cache. A good answer from the network ends this at once.
const NET_SLOW_MS = 60000, NET_SLOW_WAIT_MS = 300;
let netSlowUntil = 0;
const netIsSlow = () => Date.now() < netSlowUntil;

// Fetch from the network and keep a copy of every good answer. The copy is made BEFORE the response is handed on:
// cloning later can fail with "body already used" and the cache would silently stay old.
function fetchAndStore(e, req, key, init) {
  return fetch(req, init).then(r => {
    if (r && r.ok) {
      const copy = r.clone();
      e.waitUntil(caches.open(CACHE).then(ca => ca.put(key, copy)).catch(() => {}));
    }
    return r;
  });
}

// Network first, but a slow network must never leave the screen blank.
//   answer arrives in time         -> that answer (a redirect is passed through as it is)
//   slower than NET_WAIT_MS        -> the cached copy, if there is one (the download carries on and refreshes the cache); otherwise keep waiting
//                                     (a script or the manifest, hardMs set: after NET_HARD_MS look in the cache once more, then fail instead of waiting for ever)
//   a bad answer (404 / 5xx)       -> the cached copy for exactly this URL if there is one, else the bad answer
//   network down                   -> a cached copy (anyCached may add the shell), else Response.error()
// A script or the manifest is never answered with HTML: nothing cached means an honest failure (see v0.3.95).
function netOrCache(e, net, exactCached, anyCached, hardMs) {
  e.waitUntil(net.catch(() => {}));                                   // keep the worker alive until the download ends, even after the cache answered
  return new Promise(resolve => {
    let done = false, timer = null, hard = null;
    const answer = r => { if (done) return; done = true; clearTimeout(timer); clearTimeout(hard); resolve(r); };
    timer = setTimeout(() => anyCached().then(c => { if (c && !done) { netSlowUntil = Date.now() + NET_SLOW_MS; answer(c); } }).catch(() => {}), netIsSlow() ? NET_SLOW_WAIT_MS : NET_WAIT_MS);
    if (hardMs) hard = setTimeout(() => exactCached().then(c => answer(c || Response.error())).catch(() => answer(Response.error())), netIsSlow() ? Math.min(hardMs, 5000) : hardMs);
    net.then(
      r => { if (r && r.ok) netSlowUntil = 0; return (r && (r.ok || r.type === 'opaqueredirect')) ? answer(r) : exactCached().then(c => answer(c || r)); },
      () => anyCached().then(c => answer(c || Response.error()))
    ).catch(() => answer(Response.error()));
  });
}

function networkFirst(e, req) {
  const key = cacheKey(req), cached = () => caches.match(key);
  return netOrCache(e, fetchAndStore(e, req, key), cached, cached, NET_HARD_MS);   // scripts and the manifest: never wait for ever
}

// ── INSTALL: pre-cache the app shell ────────────────────────────────────────
// skipWaiting() is called unconditionally so a new SW always activates
// immediately — critical for Median where there may be no tab close/reopen.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      const fresh = u => new Request(u, { cache: 'reload' });        // skip the browser's HTTP cache: a deploy must not cache the copy from before it
      const soft  = u => cache.add(fresh(u)).catch(() => {});        // best-effort: one failed download must not stop the others
      // The shell and gate.js are the two files the app cannot start without. If either cannot be cached (weak signal), the install FAILS, so the
      // previous version and its cache keep running and the browser tries again on the next visit. Before, a slow shell download skipped every file
      // after it, skipWaiting() still ran, and activate deleted the old cache: the phone ended up with no gate.js and a blank page.
      return Promise.all([cache.add(fresh(SHELL)), cache.add(fresh('gate.js'))])
        .then(() => Promise.race([new Promise(r => setTimeout(r, 20000)), Promise.all([   // v0.3.98: best-effort files get 20 s at most; a hanging download must not stop skipWaiting()
          soft('manifest.json'),
          soft('sales.js'),      // the sales ledger: index.html AND pos.html need it to start offline
          soft('shifts.js'),     // the shift ledger (step 16): pos.html needs it to start offline
          soft('returns.js'),    // voids and refunds (step 19): index.html AND pos.html need it to start offline
          soft('qrcode.js'),     // QR drawing for pairing two phones with no internet (v0.3.85): pos.html needs it to start offline
          soft('barcode.js'),    // barcodes (v0.3.78): drawing, labels, and the camera reader for iPhone: index.html AND pos.html need it to start offline
          soft('pos.html'),      // the till page (best-effort; index.html also adds it)
          cache.add(FONTS_CSS).catch(() => {})   // fonts (best-effort, may fail offline)
        ])]))
        .then(() => self.skipWaiting());   // activate at once, but only once the two essential files are safely cached
    })
  );
});

// ── ACTIVATE: claim clients, purge old caches, notify tabs ──────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        // Notify every open tab → index.html will handle Median reload or show toast
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(clients => {
            clients.forEach(client =>
              client.postMessage({ type: 'NEW_VERSION', version: CACHE })
            );
          });
      })
  );
});

// ── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  // Only handle GET — never intercept POST/PUT/DELETE (Firebase writes must go to network)
  if (req.method !== 'GET') return;

  // Firebase REST & auth endpoints — network-only, never cache
  // Caching auth/data responses would serve stale license or data reads offline
  if (
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com/identitytoolkit') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('firebaseinstallations') ||
    url.includes('firebase')
  ) {
    // Let the browser handle it; offline queue in index.html handles write failures
    return;
  }

  // Navigation requests (loading the app shell) — network-first
  // Strips _mv before storing so both stamped and unstamped URLs hit the same entry.
  // { cache: 'no-store' } bypasses the browser's own HTTP cache for this fetch —
  // network-first here only matters if the fetch actually reaches the network
  // instead of being satisfied by an HTTP-cached response the host may have
  // sent cache-control headers for. Without this, a deploy can update the
  // server's file but returning visitors keep getting the old HTML anyway.
  if (req.mode === 'navigate') {
    const key = cacheKey(req);
    e.respondWith(netOrCache(e, fetchAndStore(e, req, key, { cache: 'no-store' }),
      () => caches.match(key),
      () => caches.match(key).then(cached => cached || caches.match(SHELL))));   // e.g. /?src=play has no entry of its own: the shell
    return;
  }

  // Google Fonts — cache-first (stale-while-revalidate)
  if (url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // gate.js — shared licence/tier rules, loaded as a plain <script src> by index.html and pos.html.
  // It is not a navigation, so without this rule it would pass straight to the network and both pages
  // would fail to start offline. Network-first so a deploy is picked up; cache fallback when offline.
  // sales.js (the append-only sales ledger, step 9), shifts.js (step 16), returns.js (step 19), barcode.js (v0.3.78) and qrcode.js (v0.3.85) are loaded the same way and need the same rule.
  if (/\/(gate|sales|shifts|returns|barcode|qrcode)\.js(\?|$)/.test(url)) {
    e.respondWith(networkFirst(e, req));
    return;
  }

  // manifest.json — network-first with cache fallback
  if (url.includes('manifest.json')) {
    e.respondWith(networkFirst(e, req));
    return;
  }

  // Everything else — pass through to network
});