'use strict';

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const { rateLimit } = require('express-rate-limit');

const scrypt = promisify(crypto.scrypt);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const COOKIE = 'trilhosaude_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const STATUSES = ['Agendado', 'Coletado', 'Em análise', 'Resultado disponível'];
const STEPS = ['Cadastro', 'Consulta inicial', 'Coleta do exame', 'Análise do resultado', 'Retorno com a equipe'];

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'trilhosaude',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true
});

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
  // Proteção adicional de CSRF: a interface e a API rodam na mesma origem.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: 'Origem não permitida.' });
    }
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) {
          return res.status(403).json({ error: 'Origem não permitida.' });
        }
      } catch {
        return res.status(403).json({ error: 'Origem não permitida.' });
      }
    }
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' }
});

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const str = value => typeof value === 'string' ? value.trim() : '';
function fail(res, status, error) { return res.status(status).json({ error }); }

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
async function checkPassword(password, stored) {
  const [alg, salt, expected] = String(stored).split(':');
  if (alg !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
function validateName(value) {
  const name = str(value);
  return name.length >= 2 && name.length <= 60 ? name : null;
}
function validateEmail(value) {
  const email = str(value).toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function validatePassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}
function validateDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value ? value : null;
}
function validateMoment(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(+date) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
function validId(value) { return /^[1-9]\d*$/.test(String(value)) ? value : null; }

function setSessionCookie(res, token) {
  const options = [
    `${COOKIE}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Strict',
    `Max-Age=${SESSION_SECONDS}`
  ];
  if (process.env.NODE_ENV === 'production') options.push('Secure');
  res.setHeader('Set-Cookie', options.join('; '));
}
function clearSessionCookie(res) {
  const options = [`${COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') options.push('Secure');
  res.setHeader('Set-Cookie', options.join('; '));
}
function readToken(req) {
  const item = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  const token = item && item.slice(COOKIE.length + 1);
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}
async function createSession(db, userId, res) {
  // Remova periodicamente sessões vencidas para a tabela não crescer sem limite.
  await db.execute('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
  const token = crypto.randomBytes(32).toString('hex');
  await db.execute(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))',
    [hashToken(token), userId]
  );
  setSessionCookie(res, token);
}
async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return fail(res, 401, 'Faça login para continuar.');
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.name, u.phone, u.done, u.lemb
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() LIMIT 1`,
      [hashToken(token)]
    );
    if (!rows.length) return fail(res, 401, 'Sessão expirada. Entre novamente.');
    req.user = rows[0];
    req.sessionToken = token;
    next();
  } catch (error) { next(error); }
}
async function transaction(fn) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const output = await fn(db);
    await db.commit();
    return output;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally { db.release(); }
}
async function notification(db, userId, title, detail) {
  await db.execute('INSERT INTO notifications (user_id, title, detail) VALUES (?, ?, ?)', [userId, title, detail]);
}

// ---------- Cadastro, login e sessão ----------
app.post('/api/register', authLimiter, async (req, res) => {
  const v = req.body || {};
  const name = validateName(v.name), email = validateEmail(v.email);
  if (!name || !email || !validatePassword(v.password)) {
    return fail(res, 400, 'Informe nome, e-mail válido e senha de 8 a 128 caracteres.');
  }
  const pwd = await hashPassword(v.password);
  try {
    const userId = await transaction(async db => {
      const [result] = await db.execute(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, pwd]
      );
      const id = result.insertId;
      await notification(db, id, 'Bem-vinda ao TrilhaSaúde', 'Cadastre suas consultas e exames para acompanhá-los aqui.');
      await db.execute(
        'INSERT INTO messages (user_id, is_mine, body) VALUES (?, 0, ?)',
        [id, 'Olá! Este é um chat demonstrativo, sem contato com uma equipe real.']
      );
      return id;
    });
    await createSession(pool, userId, res);
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Este e-mail já tem cadastro. Entre com sua senha.');
    throw error;
  }
});
app.post('/api/login', authLimiter, async (req, res) => {
  const email = validateEmail(req.body?.email);
  const pwd = req.body?.password;
  if (!email || typeof pwd !== 'string') return fail(res, 400, 'E-mail ou senha incorretos.');
  const [rows] = await pool.execute('SELECT id, password_hash FROM users WHERE email = ? LIMIT 1', [email]);
  if (!rows.length || !(await checkPassword(pwd, rows[0].password_hash))) {
    return fail(res, 401, 'E-mail ou senha incorretos.');
  }
  await createSession(pool, rows[0].id, res);
  res.json({ ok: true });
});
app.post('/api/logout', async (req, res) => {
  const token = readToken(req);
  if (token) await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Rotas protegidas
app.use('/api', requireAuth);

// ---------- Perfil e leitura completa dos dados ----------
app.get('/api/me', async (req, res) => {
  const id = req.user.id;
  // Lembretes persistentes: a consulta usa UTC, assim como as datas salvas no banco.
  await transaction(async db => {
    const [upcoming] = await db.execute(
      `SELECT id, title, appt_at FROM appointments
       WHERE user_id = ? AND warned = 0
       AND appt_at > UTC_TIMESTAMP()
       AND appt_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY)
       FOR UPDATE`, [id]
    );
    if (req.user.lemb) {
      for (const item of upcoming) {
        await db.execute('UPDATE appointments SET warned = 1 WHERE id = ? AND user_id = ?', [item.id, id]);
        await notification(db, id, 'Consulta nas próximas 24 horas', item.title);
      }
    }
  });

  const [[appts], [exams], [notes], [msgs]] = await Promise.all([
    pool.execute(
      `SELECT id, title, who, DATE_FORMAT(appt_at, '%Y-%m-%dT%H:%i:%sZ') AS date,
       confirmed AS ok, warned FROM appointments WHERE user_id = ? ORDER BY appt_at ASC`, [id]),
    pool.execute(
      `SELECT id, name, DATE_FORMAT(exam_date, '%Y-%m-%d') AS date, status
       FROM exams WHERE user_id = ? ORDER BY exam_date DESC, id DESC`, [id]),
    pool.execute(
      `SELECT id, title AS t, detail AS s, is_read AS r,
       UNIX_TIMESTAMP(created_at) * 1000 AS at
       FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30`, [id]),
    pool.execute(
      `SELECT id, is_mine AS me, body AS t FROM
         (SELECT id, is_mine, body FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 300) AS recent
       ORDER BY id ASC`, [id])
  ]);
  res.json({
    email: req.user.email, name: req.user.name,
    data: {
      appts: appts.map(a => ({ ...a, ok: !!a.ok, warned: !!a.warned })),
      exams,
      notes: notes.map(n => ({ ...n, r: !!n.r })),
      msgs: msgs.map(m => ({ ...m, me: !!m.me })),
      done: req.user.done, lemb: !!req.user.lemb, phone: req.user.phone
    }
  });
});
app.patch('/api/me/profile', async (req, res) => {
  const name = validateName(req.body?.name);
  const phone = str(req.body?.phone);
  if (!name || phone.length > 20) return fail(res, 400, 'Nome ou telefone inválido.');
  await transaction(async db => {
    await db.execute('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone, req.user.id]);
    await notification(db, req.user.id, 'Perfil atualizado', 'Seus dados foram salvos.');
  });
  res.json({ ok: true });
});
app.patch('/api/me/reminders', async (req, res) => {
  if (typeof req.body?.lemb !== 'boolean') return fail(res, 400, 'Valor inválido.');
  await pool.execute('UPDATE users SET lemb = ? WHERE id = ?', [req.body.lemb, req.user.id]);
  res.json({ ok: true });
});
app.patch('/api/me/progress', async (req, res) => {
  const done = req.body?.done;
  if (!Number.isInteger(done) || done < 1 || done > 5 || Math.abs(done - req.user.done) !== 1) {
    return fail(res, 400, 'Etapa inválida.');
  }
  await transaction(async db => {
    const [result] = await db.execute(
      'UPDATE users SET done = ? WHERE id = ? AND done = ?',
      [done, req.user.id, req.user.done]
    );
    if (!result.affectedRows) {
      const error = new Error('Estado da jornada mudou; recarregue a página.');
      error.status = 409; throw error;
    }
    if (done > req.user.done) await notification(db, req.user.id, 'Etapa concluída', STEPS[req.user.done]);
  });
  res.json({ ok: true });
});
app.delete('/api/me', async (req, res) => {
  await pool.execute('DELETE FROM users WHERE id = ?', [req.user.id]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Consultas ----------
app.post('/api/appointments', async (req, res) => {
  const v = req.body || {};
  const title = str(v.title), who = str(v.who), at = validateMoment(v.date);
  if (!title || title.length > 60 || who.length > 60 || !at) return fail(res, 400, 'Dados da consulta inválidos.');
  await transaction(async db => {
    await db.execute(
      'INSERT INTO appointments (user_id, title, who, appt_at) VALUES (?, ?, ?, ?)',
      [req.user.id, title, who, at]
    );
    await notification(db, req.user.id, 'Consulta agendada', title);
  });
  res.status(201).json({ ok: true });
});
app.patch('/api/appointments/:id', async (req, res) => {
  if (!validId(req.params.id) || typeof req.body?.ok !== 'boolean') return fail(res, 400, 'Dados inválidos.');
  const [result] = await pool.execute(
    'UPDATE appointments SET confirmed = ? WHERE id = ? AND user_id = ?',
    [req.body.ok, req.params.id, req.user.id]
  );
  if (!result.affectedRows) return fail(res, 404, 'Consulta não encontrada.');
  res.json({ ok: true });
});
app.delete('/api/appointments/:id', async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, 'ID inválido.');
  const [result] = await pool.execute('DELETE FROM appointments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!result.affectedRows) return fail(res, 404, 'Consulta não encontrada.');
  res.json({ ok: true });
});

// ---------- Exames ----------
app.post('/api/exams', async (req, res) => {
  const v = req.body || {};
  const name = str(v.name), date = validateDay(v.date);
  if (!name || name.length > 60 || !date || !STATUSES.includes(v.status)) return fail(res, 400, 'Dados do exame inválidos.');
  await transaction(async db => {
    await db.execute('INSERT INTO exams (user_id, name, exam_date, status) VALUES (?, ?, ?, ?)',
      [req.user.id, name, date, v.status]);
    await notification(db, req.user.id, 'Exame cadastrado', `${name} · ${v.status}`);
  });
  res.status(201).json({ ok: true });
});
app.patch('/api/exams/:id', async (req, res) => {
  if (!validId(req.params.id) || !STATUSES.includes(req.body?.status)) return fail(res, 400, 'Situação inválida.');
  const updated = await transaction(async db => {
    const [rows] = await db.execute('SELECT name FROM exams WHERE id = ? AND user_id = ? FOR UPDATE', [req.params.id, req.user.id]);
    if (!rows.length) return false;
    await db.execute('UPDATE exams SET status = ? WHERE id = ? AND user_id = ?', [req.body.status, req.params.id, req.user.id]);
    await notification(db, req.user.id, 'Exame atualizado', `${rows[0].name} · ${req.body.status}`);
    return true;
  });
  if (!updated) return fail(res, 404, 'Exame não encontrado.');
  res.json({ ok: true });
});
app.delete('/api/exams/:id', async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, 'ID inválido.');
  const [result] = await pool.execute('DELETE FROM exams WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!result.affectedRows) return fail(res, 404, 'Exame não encontrado.');
  res.json({ ok: true });
});

// ---------- Notificações ----------
app.patch('/api/notifications/:id/read', async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, 'ID inválido.');
  const [result] = await pool.execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]);
  if (!result.affectedRows) return fail(res, 404, 'Notificação não encontrada.');
  res.json({ ok: true });
});
app.post('/api/notifications/read-all', async (req, res) => {
  await pool.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});
app.delete('/api/notifications', async (req, res) => {
  await pool.execute('DELETE FROM notifications WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});

// ---------- Mensagens: demonstração sem contato com equipes reais ----------
app.post('/api/messages', async (req, res) => {
  const body = str(req.body?.text);
  if (!body || body.length > 500) return fail(res, 400, 'Mensagem vazia ou maior que 500 caracteres.');
  await transaction(async db => {
    await db.execute('INSERT INTO messages (user_id, is_mine, body) VALUES (?, 1, ?)', [req.user.id, body]);
    await db.execute('INSERT INTO messages (user_id, is_mine, body) VALUES (?, 0, ?)',
      [req.user.id, 'Resposta automática de demonstração: sua mensagem foi registrada somente neste protótipo.']);
  });
  res.status(201).json({ ok: true });
});

// ---------- Arquivos do front-end ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => {
  console.error('Erro do servidor:', err);
  if (err.status) return fail(res, err.status, err.message);
  if (err.type === 'entity.too.large') return fail(res, 413, 'Requisição muito grande.');
  if (err instanceof SyntaxError && 'body' in err) return fail(res, 400, 'JSON inválido.');
  return fail(res, 500, 'Falha interna. Verifique o terminal do servidor.');
});

async function start() {
  if (!process.env.DB_USER) throw new Error('Configure DB_USER no arquivo .env.');
  await pool.query('SELECT 1 FROM users LIMIT 1');
  app.listen(PORT, HOST, () => console.log(`TrilhaSaúde: http://${HOST}:${PORT}`));
}
start().catch(error => {
  console.error('Não foi possível iniciar. Verifique .env, MySQL e schema.sql:', error.message);
  process.exit(1);
});
