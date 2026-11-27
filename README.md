# Budget app

A personal budget tracker. It imports your real HSBC transactions, categorises them automatically, and shows your spending against your budget each month.

There's nothing to `npm install`. It uses Node's built-in SQLite, so you need **Node 22.5 or newer** (`node --version`).

## Run it

```bash
npm start
```

Then open http://localhost:3000. The app only listens on your own machine, and your data stays in `data/budget.db`.

## Get your transactions from HSBC

1. Log in to HSBC online banking on a computer (the app doesn't offer downloads).
2. Open your current account (or credit card) and choose **Download transactions**.
3. Pick a date range and the **CSV** format.
4. In the budget app, click **Import HSBC CSV**.

Overlapping statements are fine to import. Transactions you've already imported are skipped, so you can download "last 30 days" every week or two without worrying.

You can also import from the terminal: `npm run import -- ~/Downloads/TransactionHistory.csv`

## Make it yours

The first time it runs, the app copies `config/*.example.json` to `config/budgets.json` and `config/rules.json`. Those two copies are yours. Git ignores them, so your real figures never go to GitHub. Only the example versions are committed.

- **`config/budgets.json`** sets your category list (`_categories`) and monthly **targets** for the categories you're actively limiting (e.g. Food). Every other category is compared with what you usually spend (the average of the previous 3 months).
- **`config/rules.json`** holds the auto-categorisation rules. Each rule is a piece of text, and any description containing it gets that category. The first match wins.
- In the app, change a transaction's category from its dropdown. You'll then be offered a **Save rule** option so the same kind of transaction gets that category automatically in future. Saved rules are added to `rules.json`.
- Some payments, like **GOCARDLESS DD**, don't say who they're for. For those, the app offers an **only for £X** option when you save a rule, so each amount can have its own category. Regular payments lists each GoCardless amount separately.
- Use the category **Transfers** for money moved between your own accounts. Transfers are left out of both spending and income.

## Reading the dashboard

- **Targets** show spending against your limit. The thin line on each bar shows where an even pace would be today.
- **Everything else** shows this month's spend, with a marker at your usual amount.
- **Regular payments** is worked out from your transactions: anything paid most months at a similar amount. It flags bills that have gone **up** or **down**, payments that are **new**, and ones that seem to have **stopped**.

- **Green** means within target. **Amber** means you're spending faster than the month is passing. **Red** means over target.
- Refunds are deducted from their category's spending.
- Rows highlighted in amber are uncategorised. Clear those first after each import.

## Year view

Switch to **Year** at the top for this calendar year, this tax year (from 6 April) or the last 12 months. It shows each category month by month, with totals and monthly averages. A month that's noticeably above a category's average is shaded, and clicking any cell opens that month with the category expanded. Averages only count months that have transactions.

## Project layout

```
src/csv.js         CSV parsing (HSBC format, tolerant of others)
src/db.js          SQLite storage + duplicate detection
src/config.js      rules & budgets
src/report.js      targets vs actual, usual spend
src/recurring.js   regular payment detection
src/year.js        year / tax-year / last-12-months totals
src/server.js      local web server + JSON API
src/page.html      the dashboard
test/              npm test
```

## Ideas for next steps

- Automatic imports through open banking (e.g. Enable Banking), so you don't need to download CSVs
- A 12-month trend chart per category
- Splitting one transaction across categories
- A "safe to spend today" figure
