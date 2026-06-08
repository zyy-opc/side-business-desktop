import { Router } from 'express';
import { pool, queryAll } from '../config/database.js';

const router = Router();

router.get('/random', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT content FROM comfort_message WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1');
    res.json({ success: true, data: { content: rows[0]?.content ?? '' } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const page_size = Math.min(100, Math.max(1, parseInt(req.query.page_size as string) || 10));
    const keyword = req.query.keyword as string | undefined;
    const isActiveParam = req.query.is_active as string | undefined;
    const is_active = isActiveParam !== undefined ? (isActiveParam === '1' || isActiveParam === 'true' ? 1 : 0) : undefined;

    let where = '1=1';
    const params: any[] = [];
    if (keyword) { where += ' AND content LIKE ?'; params.push(`%${keyword}%`); }
    if (is_active !== undefined) { where += ' AND is_active = ?'; params.push(is_active); }

    const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM comfort_message WHERE ${where}`, params);
    const total = Number(countRows[0]?.total ?? 0);

    const offset = (page - 1) * page_size;
    const [rows] = await pool.query(`SELECT * FROM comfort_message WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, page_size, offset]);

    res.json({ success: true, data: { list: rows, total, page, page_size } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.length < 1 || content.length > 500) {
      res.status(400).json({ success: false, message: 'content 为必填字符串，长度 1-500' });
      return;
    }
    const [result] = await pool.query("INSERT INTO comfort_message (content, is_active, created_at, updated_at) VALUES (?, 1, datetime('now','localtime'), datetime('now','localtime'))", [content]);
    const [rows] = await pool.query('SELECT * FROM comfort_message WHERE id = ?', [(result as any).insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ success: false, message: 'id 必须为数字' }); return; }
    const [rows] = await pool.query('SELECT * FROM comfort_message WHERE id = ?', [id]);
    if (rows.length === 0) { res.status(404).json({ success: false, message: '记录不存在' }); return; }
    res.json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ success: false, message: 'id 必须为数字' }); return; }
    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.length < 1 || content.length > 500) {
      res.status(400).json({ success: false, message: 'content 为必填字符串，长度 1-500' });
      return;
    }
    await pool.query("UPDATE comfort_message SET content = ?, updated_at = datetime('now','localtime') WHERE id = ?", [content, id]);
    const [rows] = await pool.query('SELECT * FROM comfort_message WHERE id = ?', [id]);
    if (rows.length === 0) { res.status(404).json({ success: false, message: '记录不存在' }); return; }
    res.json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ success: false, message: 'id 必须为数字' }); return; }
    const { is_active } = req.body;
    if (is_active !== 0 && is_active !== 1) { res.status(400).json({ success: false, message: 'is_active 必须为 0 或 1' }); return; }
    await pool.query("UPDATE comfort_message SET is_active = ?, updated_at = datetime('now','localtime') WHERE id = ?", [is_active, id]);
    res.json({ success: true, data: { id, is_active } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ success: false, message: 'id 必须为数字' }); return; }
    await pool.query('DELETE FROM comfort_message WHERE id = ?', [id]);
    res.json({ success: true, data: null });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
