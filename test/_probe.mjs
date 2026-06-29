import { SqlitePool } from "streetjs";

const pool = new SqlitePool({ filePath: ":memory:" });
try {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS payments (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       reference TEXT NOT NULL UNIQUE,
       amount REAL NOT NULL,
       currency TEXT NOT NULL,
       status TEXT NOT NULL,
       created_at TEXT NOT NULL
     )`,
  );
  const info = await pool.query(`PRAGMA table_info(payments)`);
  console.log("COLUMNS:", JSON.stringify(info.rows));
  const ins = await pool.query(
    `INSERT INTO payments (reference, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?)`,
    ["ref-1", 5000, "UGX", "pending", new Date().toISOString()],
  );
  console.log("INSERT:", ins.command, ins.rowCount);
  const sel = await pool.query(`SELECT * FROM payments WHERE reference = ?`, ["ref-1"]);
  console.log("SELECT:", JSON.stringify(sel.rows));
} finally {
  await pool.close();
}
