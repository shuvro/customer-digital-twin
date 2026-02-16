import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Source = 'email' | 'message' | 'document';

interface UnknownMessage {
  id: string;
  source: Source;
  messageDate: string;
  body: string;
  [key: string]: unknown;
}

const OUT_DIR = join(process.cwd(), 'dataset', 'unknown-inputs');

function buildMessages(): UnknownMessage[] {
  const rows: Array<{ source: Source; date: string; body: string; meta?: Record<string, unknown> }> = [
    {
      source: 'email',
      date: '2024-11-03T08:10:00Z',
      body: 'Hi team, this is Jana Novak. DOB 1989-01-12. I moved to 14 Harbor Rd, Dublin and changed employer to BlueFin Labs.',
      meta: { from: 'jana.novak@example.org', language: 'en' },
    },
    {
      source: 'message',
      date: '2025-01-17T21:45:00Z',
      body: 'Thomas Weber here. New phone +49 151 7654321. Please keep phone as preferred contact.',
      meta: { channel: 'whatsapp' },
    },
    {
      source: 'document',
      date: '2025-02-02T10:30:00Z',
      body: 'Policy note: Customer Maria García López reports marriage in August and asks to add two stepchildren to coverage.',
      meta: { title: 'Meeting Summary', author: 'agent-9' },
    },
    {
      source: 'email',
      date: '2025-03-19T14:02:00Z',
      body: 'Name: Omar El-Sayed. Tax ID: EG-7781-992. Looking for life insurance and education savings options.',
      meta: { from: 'omar.family@proton.me', tags: ['lead', 'high-intent'] },
    },
    {
      source: 'message',
      date: '2025-04-07T06:12:00Z',
      body: 'Correction: use email only. Do NOT call after 18:00. Phone remains +34 600 123 456.',
      meta: { locale: 'es-ES' },
    },
    {
      source: 'document',
      date: '2025-05-23T12:00:00Z',
      body: 'Interview transcript: Customer discusses chronic back pain, physiotherapy coverage, and preference for direct calls.',
      meta: { transcriptVersion: 2 },
    },
    {
      source: 'email',
      date: '2025-06-11T18:40:00Z',
      body: 'I am Priya Raman, DOB 1990-07-03, now at 77 River St, Amsterdam. Employer changed to Orbit Retail BV.',
      meta: { from: 'priya.raman@outlook.com' },
    },
    {
      source: 'message',
      date: '2025-07-01T09:05:00Z',
      body: 'Need retirement planning details + risk cover for mortgage. Contact: +31 6 1234 7777.',
    },
    {
      source: 'document',
      date: '2025-07-18T15:55:00Z',
      body: 'Agent note: customer reported divorce finalized; marital status should be updated.',
      meta: { confidenceHint: 0.8 },
    },
    {
      source: 'email',
      date: '2025-08-29T20:10:00Z',
      body: 'Please archive old office address. Current address is 88 North Gate, Berlin 10405.',
    },
    {
      source: 'message',
      date: '2025-09-02T07:50:00Z',
      body: 'DOB typo in prior message: correct date is 1978-07-22.',
    },
    {
      source: 'document',
      date: '2025-09-12T13:20:00Z',
      body: 'Meeting notes: customer hobbies include cycling and street photography; requests annual review in Q1.',
    },
    {
      source: 'email',
      date: '2025-10-04T11:00:00Z',
      body: 'Hello, my preferred name is Maria G. Lopez. Tax id unchanged: 12345678A.',
    },
    {
      source: 'message',
      date: '2025-10-28T23:11:00Z',
      body: 'New temporary number: +49 30 0001122. Keep old number active too.',
    },
    {
      source: 'document',
      date: '2025-11-09T16:35:00Z',
      body: 'Audit memo: verify if duplicate profile exists for Thomas Weber with old address Friedrichstrasse 42.',
      meta: { reviewer: 'qa-bot' },
    },
    {
      source: 'email',
      date: '2025-11-30T05:45:00Z',
      body: 'Family context update: one child lives 50% with me. Need family health plan comparison.',
    },
    {
      source: 'message',
      date: '2025-12-14T19:17:00Z',
      body: 'Short update: still employed at FinanzBeratung AG, title now Senior Accountant.',
    },
    {
      source: 'document',
      date: '2026-01-03T09:30:00Z',
      body: 'KYC extract includes mixed formatting: Name=THOMAS WEBER; dob=22.07.1978; nationality=German.',
      meta: { format: 'legacy-kvc' },
    },
    {
      source: 'email',
      date: '2026-01-20T22:09:00Z',
      body: 'I prefer communications in German. Also interested in investment-linked insurance with tax advantages.',
    },
    {
      source: 'message',
      date: '2026-02-08T10:01:00Z',
      body: 'Please confirm coverage quote sent last week. Email is still th.weber+family@mail.de.',
    },
  ];

  return rows.map((row, idx) => ({
    id: `unknown-${String(idx + 1).padStart(3, '0')}`,
    source: row.source,
    messageDate: row.date,
    body: row.body,
    ...(row.meta ?? {}),
  }));
}

function main(): void {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const messages = buildMessages();
  for (const message of messages) {
    const path = join(OUT_DIR, `${message.id}.json`);
    writeFileSync(path, `${JSON.stringify(message, null, 2)}\n`, 'utf-8');
  }

  console.log(`Generated ${messages.length} unknown inputs in ${OUT_DIR}`);
}

main();
