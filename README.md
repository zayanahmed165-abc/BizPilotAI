# BizPilot AI — Single Admin / Flask + Oracle

## Install
In the project venv:
```powershell
pip install flask flask-cors python-dotenv oracledb werkzeug
```
Copy the files into your existing project, retaining folders. Keep your actual Oracle configuration in root `.env`.

## Admin password hash
Run in PowerShell from your activated venv:
```powershell
python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('SetYourOwnStrongPassword'))"
```
Copy the output to `ADMIN_PASSWORD_HASH` in root `.env`; set `ADMIN_USERNAME`, `FLASK_SECRET_KEY`, and Oracle values. Do not share `.env`.

## Start
From project root:
```powershell
python -m backend.app
```
Visit http://127.0.0.1:5000/

## DB column assumptions to verify
Dashboard expects `SALES.TOTAL_AMOUNT` and `EXPENSES.AMOUNT`.
Sales listing orders by `SALE_ID`; expense listing orders by `EXPENSE_ID`.
Product insert uses `PRODUCT_NAME, CATEGORY, STOCK_QUANTITY, UNIT_PRICE`, while ID/date are assumed generated/defaulted. If your table differs, revise those identifiers in `backend/app.py`.

Use `COOKIE_SECURE=true` behind HTTPS in production and a unique secret key. This sample uses a server-side signed Flask session cookie and password hash verification.
