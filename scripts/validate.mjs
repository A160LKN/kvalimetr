// Проверка базы вопросов Квалиметра.
// Запуск: node scripts/validate.mjs [путь к index.html]
// Код выхода 1, если найдена хотя бы одна ошибка.

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const file = process.argv[2] || new URL("../index.html", import.meta.url);
const html = readFileSync(file, "utf8");

const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) fail("Не найден блок <script> в index.html");
const marker = script.indexOf("/*UI*/");
if (marker < 0) fail("Не найден маркер /*UI*/, отделяющий данные от интерфейса");
const dataCode = script.slice(0, marker);

// Данные собираются дважды: база должна быть детерминированной,
// иначе «повторить тест» получит другие вопросы.
const build = () =>
  runInNewContext(`${dataCode}\n;({ POOL, ORDER, PASSAGES, SUBJECTS, PER_GEN, TEST_N, MIX_N });`, {}, { timeout: 30000 });

const A = build();
const B = build();

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const MIN_POOL = 5 * A.TEST_N; // база минимум в 5 раз больше теста
const NEED_H = Math.round(A.TEST_N * 0.75);
const NEED_M = A.TEST_N - NEED_H;

const rows = [];
for (const s of A.ORDER) {
  const pool = A.POOL[s];
  const ids = new Set();
  const texts = new Map();

  for (const q of pool) {
    const where = `[${s}] ${q.id}`;
    if (ids.has(q.id)) err(`${where}: повторяющийся id`);
    ids.add(q.id);

    if (q.d !== "h" && q.d !== "m") err(`${where}: сложность должна быть "h" или "m", а не "${q.d}"`);
    if (!q.t || !String(q.t).trim()) err(`${where}: нет темы`);
    if (!q.q || !String(q.q).trim()) err(`${where}: пустой текст вопроса`);
    if (!q.e || String(q.e).trim().length < 10) err(`${where}: нет объяснения или оно слишком короткое`);

    if (!Array.isArray(q.o) || q.o.length !== 4) {
      err(`${where}: должно быть ровно 4 варианта ответа (сейчас ${Array.isArray(q.o) ? q.o.length : "не массив"})`);
    } else {
      const norm = q.o.map((x) => String(x).trim().toLowerCase());
      if (norm.some((x) => !x)) err(`${where}: пустой вариант ответа`);
      if (new Set(norm).size !== 4) err(`${where}: варианты ответа повторяются: ${JSON.stringify(q.o)}`);
    }

    if (q.ctx && !A.PASSAGES[q.ctx]) err(`${where}: ссылка на несуществующий текст "${q.ctx}"`);

    const key = `${q.q}|${q.o?.[0]}`;
    if (texts.has(key)) err(`${where}: дублирует вопрос ${texts.get(key)}`);
    else texts.set(key, q.id);

    if (/\b(undefined|NaN|Infinity)\b/.test(`${q.q} ${q.o?.join(" ")} ${q.e}`)) err(`${where}: в тексте есть undefined/NaN/Infinity — ошибка генератора`);
  }

  const hard = pool.filter((q) => q.d === "h");
  const med = pool.filter((q) => q.d === "m");
  const famH = new Set(hard.map((q) => q.fam)).size;
  const famM = new Set(med.map((q) => q.fam)).size;

  if (pool.length < MIN_POOL) err(`[${s}] в базе ${pool.length} вопросов, нужно не меньше ${MIN_POOL}`);
  if (famH < NEED_H) err(`[${s}] разных сложных заданий ${famH}, а в тесте их ${NEED_H} — будут повторы однотипных вопросов`);
  if (famM < NEED_M) err(`[${s}] разных средних заданий ${famM}, а в тесте их ${NEED_M}`);
  if (med.length < NEED_M * 3) warn(`[${s}] средних вопросов всего ${med.length}: при повторных тестах они быстро начнут повторяться`);

  A.SUBJECTS[s].gens.forEach((g, gi) => {
    const n = pool.filter((q) => q.fam === `${s}g${gi}`).length;
    if (n === 0) err(`[${s}] генератор №${gi} («${g.t}») не создал ни одного вопроса`);
    else if (n < A.PER_GEN) warn(`[${s}] генератор №${gi} («${g.t}») создал ${n} из ${A.PER_GEN} вопросов — мало вариантов параметров`);
  });

  const a = JSON.stringify(pool.map((q) => [q.id, q.q, q.o]));
  const b = JSON.stringify(B.POOL[s].map((q) => [q.id, q.q, q.o]));
  if (a !== b) err(`[${s}] база недетерминирована: две сборки дали разные вопросы`);

  rows.push({ s, total: pool.length, hard: hard.length, med: med.length });
}

console.log("Предмет   Всего  Сложных  Средних");
for (const r of rows) console.log(`${r.s.padEnd(8)} ${String(r.total).padStart(6)} ${String(r.hard).padStart(8)} ${String(r.med).padStart(8)}`);
console.log(`Итого: ${rows.reduce((t, r) => t + r.total, 0)} вопросов\n`);

for (const w of warnings) console.log(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\nНайдено ошибок: ${errors.length}`);
  process.exit(1);
}
console.log("✓ База вопросов прошла проверку");

function fail(m) {
  console.error(`✗ ${m}`);
  process.exit(1);
}
