// Throwaway fixture-builder for the e2e sandbox check (2026-07-01).
// Builds a small "library lending" SQLite database with real FK constraints:
// authors -> books -> loans <- members
// Kept separate from the demo dataset (customers/products/orders/order_items).
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "library.sqlite");
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE authors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL
);

CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  genre TEXT NOT NULL,
  published_year INTEGER NOT NULL,
  FOREIGN KEY (author_id) REFERENCES authors(id)
);

CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  join_date TEXT NOT NULL,
  membership_tier TEXT NOT NULL
);

CREATE TABLE loans (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  loaned_at TEXT NOT NULL,
  returned_at TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
);
`);

const authors = [
  ["Ursula K. Le Guin", "USA"],
  ["Haruki Murakami", "Japan"],
  ["Chimamanda Ngozi Adichie", "Nigeria"],
  ["Yuval Noah Harari", "Israel"],
  ["Agatha Christie", "UK"],
  ["Gabriel Garcia Marquez", "Colombia"],
  ["Toni Morrison", "USA"],
  ["Kazuo Ishiguro", "UK"],
  ["Isabel Allende", "Chile"],
  ["Neil Gaiman", "UK"],
  ["Octavia Butler", "USA"],
  ["Jorge Luis Borges", "Argentina"],
];
const insAuthor = db.prepare("INSERT INTO authors (id, name, country) VALUES (?, ?, ?)");
authors.forEach((a, i) => insAuthor.run(i + 1, a[0], a[1]));

const genres = ["Sci-Fi", "Literary Fiction", "Mystery", "Non-Fiction", "Fantasy"];
const books = [
  ["The Left Hand of Darkness", 1, "Sci-Fi", 1969],
  ["Norwegian Wood", 2, "Literary Fiction", 1987],
  ["Kafka on the Shore", 2, "Fantasy", 2002],
  ["Americanah", 3, "Literary Fiction", 2013],
  ["Half of a Yellow Sun", 3, "Literary Fiction", 2006],
  ["Sapiens", 4, "Non-Fiction", 2011],
  ["Homo Deus", 4, "Non-Fiction", 2015],
  ["Murder on the Orient Express", 5, "Mystery", 1934],
  ["And Then There Were None", 5, "Mystery", 1939],
  ["One Hundred Years of Solitude", 6, "Literary Fiction", 1967],
  ["Beloved", 7, "Literary Fiction", 1987],
  ["Never Let Me Go", 8, "Sci-Fi", 2005],
  ["The Remains of the Day", 8, "Literary Fiction", 1989],
  ["The House of the Spirits", 9, "Fantasy", 1982],
  ["American Gods", 10, "Fantasy", 2001],
  ["Coraline", 10, "Fantasy", 2002],
  ["Kindred", 11, "Sci-Fi", 1979],
  ["Parable of the Sower", 11, "Sci-Fi", 1993],
  ["Ficciones", 12, "Fantasy", 1944],
  ["The Dispossessed", 1, "Sci-Fi", 1974],
];
const insBook = db.prepare(
  "INSERT INTO books (id, title, author_id, genre, published_year) VALUES (?, ?, ?, ?, ?)",
);
books.forEach((b, i) => insBook.run(i + 1, b[0], b[1], b[2], b[3]));

const tiers = ["basic", "premium", "student"];
const memberNames = [
  "Alice Chen", "Marcus Reed", "Priya Nair", "Diego Alvarez", "Fatima Al-Sayed",
  "Owen Walsh", "Grace Kim", "Leo Novak", "Amara Okafor", "Sofia Rossi",
  "Ethan Brooks", "Mei Lin", "Noah Bergstrom", "Ingrid Solberg", "Tariq Hassan",
  "Ravi Shah", "Elena Petrova", "Jamal Carter", "Nina Kowalski", "Hugo Mendes",
];
const insMember = db.prepare(
  "INSERT INTO members (id, name, join_date, membership_tier) VALUES (?, ?, ?, ?)",
);
memberNames.forEach((name, i) => {
  const joinDate = `202${1 + (i % 4)}-0${1 + (i % 9) % 9}-1${i % 9}`;
  insMember.run(i + 1, name, joinDate, tiers[i % tiers.length]);
});

// Loans: skew so a few members have many active (unreturned) loans, to give
// the "which members have the most active loans" question a clear answer.
const insLoan = db.prepare(
  "INSERT INTO loans (id, book_id, member_id, loaned_at, returned_at) VALUES (?, ?, ?, ?, ?)",
);
let loanId = 1;
const activeHeavyMembers = [1, 3, 7]; // Alice Chen, Priya Nair, Leo Novak
for (const memberId of activeHeavyMembers) {
  for (let k = 0; k < 4; k++) {
    const bookId = ((loanId * 3 + k) % books.length) + 1;
    insLoan.run(loanId, bookId, memberId, `2026-0${1 + (k % 6)}-0${1 + k}`, null);
    loanId++;
  }
}
for (let i = 0; i < 20; i++) {
  const bookId = (i % books.length) + 1;
  const memberId = ((i + 5) % memberNames.length) + 1;
  const returned = i % 3 === 0 ? null : `2026-0${1 + (i % 6)}-2${i % 8}`;
  insLoan.run(loanId, bookId, memberId, `2025-1${1 + (i % 2)}-0${1 + (i % 9) % 9}`, returned);
  loanId++;
}

db.close();

console.log("Created library.sqlite at", DB_PATH);
console.log("Rows: authors=" + authors.length, "books=" + books.length, "members=" + memberNames.length, "loans=" + (loanId - 1));
