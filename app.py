import os
from pathlib import Path
from functools import wraps
from dotenv import load_dotenv
from flask import Flask, jsonify, request, session, redirect
from flask_cors import CORS
from werkzeug.security import check_password_hash

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
from db import get_connection

app = Flask(__name__, static_folder=str(ROOT_DIR / "frontend"), static_url_path="/static")
app.secret_key = os.getenv("FLASK_SECRET_KEY", "CHANGE_ME")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "false").lower() == "true",
                  PERMANENT_SESSION_LIFETIME=28800)
CORS(app, supports_credentials=True)

def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("admin_logged_in"):
            return jsonify({"status":"error","message":"Authentication required"}), 401
        return fn(*args, **kwargs)
    return wrapper

def rows(cursor):
    keys = [c[0].lower() for c in cursor.description]
    result = []
    for row in cursor.fetchall():
        result.append({k: (v.isoformat() if hasattr(v, "isoformat") else v) for k,v in zip(keys,row)})
    return result

def query(sql):
    conn = cur = None
    try:
        conn = get_connection(); cur = conn.cursor(); cur.execute(sql)
        return rows(cur)
    finally:
        if cur: cur.close()
        if conn: conn.close()

@app.get("/")
def home():
    return app.send_static_file("index.html" if session.get("admin_logged_in") else "login.html")

@app.get("/login")
def login_page():
    return redirect("/") if session.get("admin_logged_in") else app.send_static_file("login.html")

@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    expected_user = os.getenv("ADMIN_USERNAME", "admin")
    password_hash = os.getenv("ADMIN_PASSWORD_HASH", "")
    if not password_hash:
        return jsonify({"status":"error","message":"Set ADMIN_PASSWORD_HASH in root .env"}), 500
    if str(data.get("username","")).strip() != expected_user or not check_password_hash(password_hash, str(data.get("password",""))):
        return jsonify({"status":"error","message":"Incorrect username or password"}), 401
    session.clear()
    session["admin_logged_in"] = True
    session["admin_username"] = expected_user
    session.permanent = True
    return jsonify({"status":"success","message":"Login successful"}), 200

@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"status":"success","message":"Logged out"})

@app.get("/api/session")
def session_status():
    return jsonify({"authenticated":bool(session.get("admin_logged_in")),"username":session.get("admin_username")})

@app.get("/api/health")
def health():
    conn = None
    try:
        conn = get_connection()
        return jsonify({"status":"success","message":"Backend running","database":"Oracle connected"})
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),500
    finally:
        if conn: conn.close()

@app.get("/api/dashboard")
@admin_required
def dashboard():
    conn = cur = None
    try:
        conn=get_connection(); cur=conn.cursor()
        cur.execute("SELECT NVL(SUM(total_amount),0) FROM SALES")
        sales=float(cur.fetchone()[0] or 0)
        cur.execute("SELECT COUNT(*) FROM PRODUCTS")
        product_count=int(cur.fetchone()[0] or 0)
        cur.execute("SELECT COUNT(*) FROM EXPENSES")
        expense_count=int(cur.fetchone()[0] or 0)
        cur.execute("SELECT NVL(SUM(amount),0) FROM EXPENSES")
        expenses=float(cur.fetchone()[0] or 0)
        return jsonify({"status":"success","total_sales":sales,"total_expenses":expenses,
                        "total_products":product_count,"expense_records":expense_count,
                        "net_profit":sales-expenses})
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),500
    finally:
        if cur: cur.close()
        if conn: conn.close()

@app.get("/api/products")
@admin_required
def products_get():
    try: return jsonify(query("SELECT * FROM PRODUCTS ORDER BY PRODUCT_ID"))
    except Exception as e: return jsonify({"status":"error","message":str(e)}),500

@app.post("/api/products")
@admin_required
def products_post():
    conn=cur=None
    try:
        d=request.get_json(silent=True) or {}
        name=str(d.get("product_name") or d.get("name") or "").strip()
        category=str(d.get("category") or "General").strip()
        quantity=int(d.get("stock_quantity",d.get("quantity")))
        price=float(d.get("unit_price",d.get("price")))
        if not name or quantity<0 or price<0:
            return jsonify({"status":"error","message":"Provide valid name, quantity and price"}),400
        conn=get_connection(); cur=conn.cursor()
        cur.execute("""INSERT INTO PRODUCTS (PRODUCT_NAME,CATEGORY,STOCK_QUANTITY,UNIT_PRICE)
                       VALUES (:name,:category,:quantity,:price)""",
                    {"name":name,"category":category,"quantity":quantity,"price":price})
        conn.commit()
        return jsonify({"status":"success","message":"Product added successfully"}),201
    except (ValueError,TypeError):
        return jsonify({"status":"error","message":"Quantity must be an integer; price must be numeric"}),400
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"status":"error","message":str(e)}),500
    finally:
        if cur: cur.close()
        if conn: conn.close()

@app.get("/api/sales")
@admin_required
def sales_get():
    try: return jsonify(query("SELECT * FROM SALES ORDER BY SALE_ID"))
    except Exception as e: return jsonify({"status":"error","message":str(e)}),500

@app.get("/api/expenses")
@admin_required
def expenses_get():
    try: return jsonify(query("SELECT * FROM EXPENSES ORDER BY EXPENSE_ID"))
    except Exception as e: return jsonify({"status":"error","message":str(e)}),500

if __name__ == "__main__":
    app.run(host="127.0.0.1",port=5000,debug=True)
