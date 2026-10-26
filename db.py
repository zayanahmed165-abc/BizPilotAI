import os
from pathlib import Path
import oracledb
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

def get_connection():
    user=os.getenv("ORACLE_USER")
    password=os.getenv("ORACLE_PASSWORD")
    dsn=os.getenv("ORACLE_DSN","localhost:1521/XE")
    if not user or not password:
        raise RuntimeError("Set ORACLE_USER and ORACLE_PASSWORD in root .env")
    client_dir=os.getenv("ORACLE_CLIENT_LIB_DIR")
    if client_dir:
        oracledb.init_oracle_client(lib_dir=client_dir)
    return oracledb.connect(user=user,password=password,dsn=dsn)
