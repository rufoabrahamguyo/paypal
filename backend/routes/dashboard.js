import { Router } from 'express';
import { userFromRequest } from '../auth.js';
import {
  addTicketMessage,
  auditCounts,
  auditTrail,
  disputeLedger,
  buyerDashboard,
  getListing,
  getOrder,
  getSeller,
  getTicket,
  identityStatus,
  insertTicket,
  listBuyerEmails,
  listIdentitySellers,
  listTickets,
  sellerDashboard,
  setTicketStatus,
  socialsForSeller,
} from '../db.js';

export const dashboard = Router();

const TOPICS = new Set(['order', 'payment', 'listing', 'account', 'other']);
const ROLES = new Set(['buyer', 'seller']);
const STATUSES = new Set(['open', 'in_review', 'resolved']);

const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

dashboard.get('/buyers', (req, res) => res.json(listBuyerEmails()));

dashboard.get('/dashboard/buyer', (req, res) => {
  const user = userFromRequest(req);
  const email = user?.role === 'buyer' ? user.email : String(req.query.email || '').trim();
  if (!emailOk(email)) return res.status(400).json({ error: 'A buyer email is required' });
  res.json(buyerDashboard(email));
});

dashboard.get('/dashboard/seller', (req, res) => {
  const user = userFromRequest(req);
  const sellerId = user?.role === 'seller' ? user.seller_id : String(req.query.seller_id || '');
  const data = sellerDashboard(sellerId);
  if (!data) return res.status(404).json({ error: 'Unknown seller' });
  if (user?.role === 'seller' && user.seller_id === sellerId) {
    data.seller.socials = socialsForSeller(sellerId, { codes: true });
    data.seller.identity = identityStatus(sellerId);
  }
  res.json(data);
});

dashboard.get('/admin/disputes', (req, res) => res.json(disputeLedger()));

dashboard.get('/admin/audit', (req, res) => {
  const user = userFromRequest(req);
  res.json({
    counts: auditCounts(),
    trail: auditTrail(),
    tickets: listTickets({ openOnly: true }).slice(0, 50),
    identities: user?.role === 'admin' ? listIdentitySellers() : [],
  });
});

dashboard.get('/support', (req, res) => {
  const scope = req.query.scope;
  if (scope === 'all') return res.json(listTickets());
  const email = String(req.query.email || '').trim();
  const sellerId = String(req.query.seller_id || '').trim();
  if (!email && !sellerId) return res.json([]);
  res.json(listTickets({ email: email || undefined, sellerId: sellerId || undefined }));
});

dashboard.get('/support/:id', (req, res) => {
  const ticket = getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

dashboard.post('/support', (req, res) => {
  const user = userFromRequest(req);
  if (!user || !ROLES.has(user.role)) return res.status(401).json({ error: 'Sign in as a buyer or seller to file a complaint' });
  const body = req.body ?? {};
  const author_role = user.role;
  const author_email = user.email;
  const topic = String(body.topic || '');
  const subject = String(body.subject || '').trim();
  const message = String(body.body || body.message || '').trim();
  if (!TOPICS.has(topic)) return res.status(400).json({ error: 'Choose a topic' });
  if (subject.length < 3 || subject.length > 140) return res.status(400).json({ error: 'Subject should be 3–140 characters' });
  if (message.length < 10 || message.length > 4000) return res.status(400).json({ error: 'Describe the issue in 10–4000 characters' });

  let seller_id = null;
  if (author_role === 'seller') {
    seller_id = user.seller_id;
    if (!getSeller(seller_id)) return res.status(400).json({ error: 'This account has no shop' });
  }
  let order_id = body.order_id ? String(body.order_id).trim() : null;
  const order = order_id ? getOrder(order_id) : null;
  if (order_id && !order) return res.status(400).json({ error: 'That order id was not found' });
  if (!order_id) order_id = null;
  if (order && !seller_id) seller_id = getListing(order.listing_id)?.seller_id || null;

  const ticket = insertTicket({
    author_role,
    author_name: user.name,
    author_email,
    seller_id,
    order_id,
    topic,
    subject,
    body: message,
  });
  res.status(201).json(ticket);
});

dashboard.post('/support/:id/replies', (req, res) => {
  const ticket = getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const message = String(req.body?.body || req.body?.message || '').trim();
  if (message.length < 2 || message.length > 4000) return res.status(400).json({ error: 'Write a reply' });
  const author_role = String(req.body?.author_role || '');
  if (author_role === 'support') {
    return res.json(addTicketMessage(ticket.id, { author_role: 'support', author_name: 'Funguo support', body: message }));
  }
  if (author_role !== ticket.author_role) return res.status(400).json({ error: 'This reply does not match the ticket' });
  const email = String(req.body?.author_email || '').trim().toLowerCase();
  if (email !== ticket.author_email.toLowerCase()) return res.status(400).json({ error: 'Use the email on the ticket to reply' });
  res.json(addTicketMessage(ticket.id, {
    author_role,
    author_name: req.body?.author_name ? String(req.body.author_name).slice(0, 120) : ticket.author_name,
    body: message,
  }));
});

dashboard.post('/support/:id/status', (req, res) => {
  const ticket = getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const status = String(req.body?.status || '');
  if (!STATUSES.has(status)) return res.status(400).json({ error: 'Status must be open, in_review, or resolved' });
  res.json(setTicketStatus(ticket.id, status));
});
