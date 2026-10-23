import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowRight, Gavel, Users, Trophy, Timer, Shield, Sparkles, ListOrdered, Activity, History, LogIn, Plus,
} from 'lucide-react';
import { Brand } from '@/components/Brand';
import { Button, Card, Input, SectionLabel } from '@/components/ui';
import { BASE_PLAYERS } from '@shared/data/players';
import { FRANCHISES } from '@shared/data/reference';
import { ROOM_CODE_RE } from '@shared/engine/core';
import { useMyRooms } from '@/hooks/realtime';
import { initials } from '@/components/game';
import { useSession } from '@/stores/session';

const FEATURES = [
  { icon: Gavel, title: 'Live multiplayer auction', text: 'Every bid is validated on the server and appears on every screen instantly — phones included.' },
  { icon: Timer, title: 'Server-synced clock', text: 'One authoritative countdown. The auction keeps running even if the host closes their laptop.' },
  { icon: Shield, title: 'Right to Match', text: 'Former franchises can match the winning bid and keep their player.' },
  { icon: Sparkles, title: 'Power cards', text: 'Optional mystery cards — Sniper, Freeze, Sponsorship… and a few nasty surprises.' },
  { icon: ListOrdered, title: 'Playing XI builder', text: 'Pick your XI, captain and keeper with live rule checks. Works great on mobile.' },
  { icon: Activity, title: 'Ball-by-ball T20 engine', text: 'Two innings, strike rotation, bowling quotas, extras, dismissals and full scorecards.' },
  { icon: Trophy, title: 'Full IPL season', text: 'Round-robin league, NRR points table, Qualifiers, Eliminator and the Final.' },
  { icon: Users, title: 'Clear roles', text: 'Host, auctioneer, franchise owners and spectators each get their own controls.' },
];

const STEPS = [
  { n: '01', title: 'Create a room', text: 'Choose mega or mini auction, team count, purse and optional RTM / power cards. Share the code.' },
  { n: '02', title: 'Claim franchises', text: 'Friends join on any device and claim an available franchise. Everyone else can spectate.' },
  { n: '03', title: 'Run the auction', text: 'Players come up tier by tier. Bid before the clock runs out; the auctioneer hammers SOLD or UNSOLD.' },
  { n: '04', title: 'Pick your XI', text: 'Choose 11 with at most 4 overseas, a keeper and at least 5 bowling options. Name a captain.' },
  { n: '05', title: 'Play the season', text: 'Simulate the league ball by ball, climb the table and fight through the playoffs to the trophy.' },
];

export function HomePage() {
  const nav = useNavigate();
  const uid = useSession((s) => s.uid);
  const recent = useMyRooms(uid);
  const [code, setCode] = useState('');
  const valid = ROOM_CODE_RE.test(code);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) nav(`/join/${code}`);
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Brand />
          <nav className="flex items-center gap-2">
            <a href="#how-to-play" className="hidden px-3 text-sm font-medium text-muted hover:text-fg sm:block">How to play</a>
            <Link to="/join"><Button variant="outline" size="sm" icon={<LogIn className="size-4" />}>Join</Button></Link>
            <Link to="/create"><Button variant="primary" size="sm" icon={<Plus className="size-4" />}>Create</Button></Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 lg:grid-cols-[1.15fr_0.85fr] lg:pt-20">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
              <SectionLabel>Multiplayer · Real-time · Free</SectionLabel>
              <h1 className="mt-4 font-display text-5xl font-extrabold uppercase leading-[0.92] sm:text-7xl">
                Run the auction.<br /><span className="text-gold-gradient">Build the dynasty.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">
                Bid live against your friends for {BASE_PLAYERS.length} cricketers, assemble your franchise and play a full T20 season — ball by ball.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/create"><Button variant="primary" size="lg" icon={<Gavel className="size-5" />}>Create room</Button></Link>
                <Link to="/join"><Button variant="outline" size="lg" icon={<Users className="size-5" />}>Join room</Button></Link>
                <a href="#how-to-play"><Button variant="ghost" size="lg">How to play</Button></a>
              </div>
              <form onSubmit={submit} className="mt-8 flex max-w-md gap-2" aria-label="Quick join">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8))}
                  placeholder="Have a code? IPL-7K3X"
                  aria-label="Room code"
                  className="font-display text-lg tracking-[0.2em]"
                />
                <Button type="submit" variant="secondary" disabled={!valid} aria-label="Go to room" icon={<ArrowRight className="size-4" />} className="h-11" />
              </form>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, delay: 0.1 }}>
              <HeroBoard />
            </motion.div>
          </div>
        </section>

        {recent.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 pb-10">
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <History className="size-4 text-gold-400" aria-hidden />
              <span className="text-sm font-semibold">Rejoin a recent room</span>
              <div className="flex flex-wrap gap-2">
                {recent.map((c) => (
                  <Link key={c} to={`/room/${c}`} className="rounded-lg border border-white/10 bg-ink-800 px-3 py-1.5 font-display text-base tracking-widest text-gold-300 hover:border-gold-400/60">{c}</Link>
                ))}
              </div>
            </Card>
          </section>
        )}

        <section className="mx-auto max-w-6xl px-4 pb-16">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [BASE_PLAYERS.length, 'Players'],
              [FRANCHISES.length, 'Franchises'],
              [14, 'Power cards'],
              ['20', 'Overs a side'],
            ].map(([v, l]) => (
              <Card key={String(l)} className="px-5 py-4">
                <div className="font-display text-4xl font-bold text-gold-gradient">{v}</div>
                <div className="text-xs font-semibold uppercase tracking-widest text-subtle">{l}</div>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20">
          <SectionLabel>What's inside</SectionLabel>
          <h2 className="mt-2 font-display text-4xl font-bold uppercase">Everything an auction night needs</h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <Card key={f.title} className="p-5">
                <div className="grid size-10 place-items-center rounded-xl bg-gold-400/10 text-gold-300"><f.icon className="size-5" aria-hidden /></div>
                <h3 className="mt-4 text-lg font-semibold uppercase tracking-wide">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{f.text}</p>
              </Card>
            ))}
          </div>
        </section>

        <section id="how-to-play" className="scroll-mt-20 border-t border-white/5 bg-ink-900/40">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <SectionLabel>How to play</SectionLabel>
            <h2 className="mt-2 font-display text-4xl font-bold uppercase">From lobby to trophy in five steps</h2>
            <ol className="mt-10 grid gap-4 md:grid-cols-5">
              {STEPS.map((s) => (
                <li key={s.n} className="surface rounded-2xl p-5">
                  <div className="font-display text-3xl font-bold text-gold-400/80">{s.n}</div>
                  <div className="mt-2 font-semibold uppercase tracking-wide">{s.title}</div>
                  <p className="mt-1.5 text-sm text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
            <div className="mt-10 grid gap-4 text-sm text-muted md:grid-cols-3">
              <p><strong className="text-fg">Money.</strong> Purses are in ₹ lakhs (100 L = ₹1 Cr). You are charged only when the hammer falls, and you must keep enough to complete a minimum squad.</p>
              <p><strong className="text-fg">Bids.</strong> Opening bid is the base price, then +5 L under ₹1 Cr, +10 L to ₹3 Cr, +25 L to ₹10 Cr, +50 L to ₹20 Cr, +₹1 Cr above.</p>
              <p><strong className="text-fg">Ratings.</strong> Player ratings are fictional gameplay values used by the simulator — not official statistics.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <Brand compact />
          <p>Unofficial fan project. Not affiliated with the IPL, BCCI or any franchise.</p>
        </div>
      </footer>
    </div>
  );
}

/** Decorative live-auction preview built from real game components (no images). */
function HeroBoard() {
  const p = BASE_PLAYERS.find((x) => x.id === 'P031') ?? BASE_PLAYERS[0];
  return (
    <div className="surface-strong relative overflow-hidden rounded-3xl p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-gold-400/10 blur-3xl" />
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full bg-danger/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-red-300">
          <span className="size-1.5 animate-pulse rounded-full bg-danger" />Live
        </span>
        <span className="font-display text-sm tracking-widest text-subtle">LOT 07 / {BASE_PLAYERS.length}</span>
      </div>
      <div className="mt-6 flex items-center gap-4">
        <div className="grid size-20 place-items-center rounded-full bg-ink-700 font-display text-3xl font-bold" style={{ boxShadow: '0 0 0 2px #b69cff, 0 0 30px -6px #b69cff' }}>{initials(p.name)}</div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-tier-diamond">Diamond · Bowler</div>
          <div className="font-display text-4xl font-bold uppercase leading-none">{p.name}</div>
          <div className="mt-1 text-xs text-muted">Base ₹2 Cr · Sim rating {p.rating}</div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-[1fr_auto] items-end gap-4 rounded-2xl bg-ink-900/70 p-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-subtle">Current bid</div>
          <div className="font-display text-5xl font-bold text-gold-gradient">₹18.50 Cr</div>
          <div className="mt-1 flex items-center gap-2 text-sm"><span className="size-2.5 rounded-full bg-[#004BA0]" />Mumbai Indians lead</div>
        </div>
        <div className="grid size-16 place-items-center rounded-full border-4 border-gold-400/80 font-display text-2xl font-bold">9</div>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-2">
        {FRANCHISES.slice(0, 5).map((f) => (
          <div key={f.id} className="rounded-lg bg-ink-900/60 px-2 py-2 text-center">
            <div className="mx-auto size-2 rounded-full" style={{ background: f.color }} />
            <div className="mt-1 text-[11px] font-bold">{f.short}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
