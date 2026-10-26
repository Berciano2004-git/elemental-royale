// HUD: barras, poderes, enfriamientos, tormenta, minimapa, avisos y nombres.

import {
  ELEMENTS,
  HALF_WORLD,
  RARITIES,
  WORLD_SIZE,
  comboFor,
} from '../shared/constants.js';

const ICONS = { fire: '🔥', water: '💧', wind: '🌀', earth: '🪨' };
const REGION_NAMES = {
  forest: 'Bosque de Elda',
  grass: 'Praderas Verdes',
  desert: 'Desierto Ardiente',
  beach: 'Costa Dorada',
  highland: 'Tierras Altas',
  mountain: 'Picos Nublados',
  snow: 'Cumbres Heladas',
  water: 'Mar Esmeralda',
};

const $ = (id) => document.getElementById(id);

function cssColor(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

function rgba(hex, alpha) {
  const value = typeof hex === 'number' ? hex : parseInt(hex.replace('#', ''), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class HUD {
  constructor() {
    this.root = $('hud');
    this.hpFill = $('hp-fill');
    this.shieldFill = $('shield-fill');
    this.hpText = $('hp-text');
    this.manaFill = $('mana-fill');
    this.manaText = $('mana-text');
    this.staminaFill = $('stamina-fill');
    this.aliveCount = $('alive-count');
    this.stormStatus = $('storm-status');
    this.stormSub = $('storm-sub');
    this.stormPill = $('storm-pill');
    this.stormPhase = $('storm-phase');
    this.matchTimer = $('match-timer');
    this.minimap = $('minimap');
    this.minimapContext = this.minimap.getContext('2d');
    this.regionLabel = $('minimap-region');
    this.playerName = $('hud-player-name');
    this.killsLabel = $('hud-kills');
    this.killfeed = $('killfeed');
    this.toasts = $('toasts');
    this.spectate = $('spectate-banner');
    this.aimCursor = $('aim-cursor');
    this.damageFlash = $('damage-flash');
    this.stormOverlay = $('storm-overlay');
    this.nameplateLayer = $('nameplates');
    this.abilityHints = $('ability-hints');
    this.comboCard = $('combo-card');
    this.comboName = $('combo-name');
    this.comboHint = $('combo-hint');
    this.comboCd = $('combo-cd');
    this.slots = [...document.querySelectorAll('.power-slot')];
    this.nameplates = new Map();
    this.lastSelf = null;
    this.snap = null;
    this.selfId = 0;
    this.minimapBg = null;
    this.stormAmount = 0;
    this.slotCache = [null, null];
    this.toastQueue = [];
    this.aimColor = '#f3c96b';
    this.damageTimer = null;
  }

  show(visible) {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) {
      this.aimCursor.classList.add('hidden');
      this.nameplateLayer.innerHTML = '';
      this.nameplates.clear();
    }
  }

  reset() {
    this.slotCache = [null, null];
    this.lastSelf = null;
    this.snap = null;
    this.killfeed.innerHTML = '';
    this.toasts.innerHTML = '';
    this.spectate.classList.add('hidden');
    this.aimCursor.classList.add('hidden');
    this.stormOverlay.style.opacity = '0';
    this.nameplateLayer.innerHTML = '';
    this.nameplates.clear();
    this.playerName.textContent = 'Mago';
    this.killsLabel.textContent = '0 eliminaciones';
    this.aliveCount.textContent = '10';
    this.matchTimer.textContent = '00:00';
    this.manaFill.style.width = '100%';
    this.hpFill.style.width = '100%';
    this.shieldFill.style.width = '0%';
    this.staminaFill.style.width = '100%';
    this.hpText.textContent = '100 / 100';
    this.manaText.textContent = '100';
    this.regionLabel.textContent = 'La isla';
    this.updateSlotEmpty(0);
    this.updateSlotEmpty(1);
    this.comboCard.className = 'combo-card locked';
    this.comboName.textContent = 'Combinación';
    this.comboHint.textContent = 'Equipa dos elementos';
    this.comboCd.classList.remove('show');
    this.abilityHints.innerHTML = '<span>Busca cristales de poder por la isla</span>';
    this.minimapContext.clearRect(0, 0, this.minimap.width, this.minimap.height);
    this.minimapContext.fillStyle = '#152238';
    this.minimapContext.fillRect(0, 0, this.minimap.width, this.minimap.height);
  }

  setPlayerName(name) {
    this.playerName.textContent = name;
  }

  setMinimapWorld(canvas) {
    this.minimapBg = canvas;
  }

  setRegion(regionKey) {
    this.regionLabel.textContent = REGION_NAMES[regionKey] || 'La isla';
  }

  update(snap, selfId) {
    this.snap = snap;
    this.selfId = selfId;
    const self = snap.players.find((p) => p.i === selfId);
    if (!self) return;
    this.lastSelf = self;

    const hp = Math.max(0, Math.min(100, self.hp));
    this.hpFill.style.width = `${hp}%`;
    this.shieldFill.style.width = `${Math.min(100, self.sh || 0)}%`;
    this.hpText.textContent = `${Math.ceil(hp)} / 100`;
    this.manaFill.style.width = `${Math.max(0, Math.min(100, self.mn))}%`;
    this.manaText.textContent = `${Math.round(self.mn)}`;
    this.staminaFill.style.width = `${Math.max(0, Math.min(100, self.st))}%`;
    this.playerName.textContent = this.playerName.textContent || 'Mago';
    this.killsLabel.textContent = self.k === 1 ? '1 eliminación' : `${self.k} eliminaciones`;
    this.aliveCount.textContent = snap.alive;

    this.matchTimer.textContent = this.formatTime(snap.time);
    this.updateStorm(snap, self);
    this.updatePowers(self, snap);
    this.drawMinimap(snap);
  }

  updateStorm(snap, self) {
    const storm = snap.storm;
    if (!storm) return;
    const phase = Math.min(storm.total, storm.phase + 1);
    this.stormPhase.textContent = phase;
    const dist = Math.hypot(self.x - storm.cx, self.z - storm.cz);
    const outside = dist > storm.r - 4;
    let status = '';
    let sub = '';
    if (outside) {
      status = `¡Fuera de la tormenta! −${storm.dps} vida/s`;
      sub = 'Corre hacia el círculo seguro';
    } else if (storm.mode === 'wait') {
      status = `La tormenta se cierra en ${Math.ceil(storm.timer)}s`;
      sub = storm.next ? `Siguiente círculo: ${Math.round(storm.next.r)} m` : 'Prepárate';
    } else if (storm.mode === 'shrink') {
      status = `¡La tormenta avanza! ${Math.ceil(storm.timer)}s`;
      sub = 'Sigue el círculo azul del minimapa';
    } else {
      status = 'Tormenta final';
      sub = `Daño ${storm.dps}/s · no hay refugio`;
    }
    if (status !== this.stormStatus.textContent) this.stormStatus.textContent = status;
    if (sub !== this.stormSub.textContent) this.stormSub.textContent = sub;
    this.stormPill.classList.toggle('danger', outside || storm.mode === 'shrink');
    const intensity = outside ? Math.min(1, 0.35 + Math.min(0.65, (dist - storm.r) / 220)) : 0;
    this.stormAmount = intensity;
    this.stormOverlay.style.opacity = String(intensity);
  }

  updatePowers(self, snap) {
    for (let i = 0; i < 2; i++) {
      const slot = self.sl[i];
      const cd = self.cd[i];
      if (!slot) this.updateSlotEmpty(i);
      else this.updateSlot(i, slot, cd, self.act === i);
    }

    const a = self.sl[0];
    const b = self.sl[1];
    const combo = a && b ? comboFor(a.e, b.e) : null;
    if (combo) {
      this.comboName.textContent = combo.name;
      const ready = self.cc <= 0 && self.mn >= combo.mana;
      this.comboCard.className = `combo-card ${ready ? 'ready' : 'locked'}`;
      this.comboHint.textContent =
        self.cc > 0
          ? `Se recarga en ${Math.ceil(self.cc)}s`
          : self.mn < combo.mana
            ? `Necesitas ${combo.mana} de maná`
            : `${combo.mana} maná · pulsa 3`;
      this.comboCd.classList.toggle('show', self.cc > 0);
      this.comboCd.textContent = self.cc > 0 ? Math.ceil(self.cc) : '';
      this.comboCd.style.background = `rgba(4, 7, 18, 0.68)`;
    } else {
      this.comboCard.className = 'combo-card locked';
      this.comboName.textContent = 'Combinación';
      this.comboHint.textContent = 'Equipa dos elementos';
      this.comboCd.classList.remove('show');
    }

    const activeSlot = self.sl[self.act];
    if (activeSlot) {
      const meta = ELEMENTS[activeSlot.e];
      const abilities = meta.abilities;
      const cds = self.cd[self.act] || [0, 0];
      this.abilityHints.innerHTML =
        `<span><b>Clic izq</b> ${abilities[0].name}${cds[0] > 0 ? ` · ${Math.ceil(cds[0])}s` : ''}</span>` +
        `<span><b>Clic der</b> ${abilities[1].name}${cds[1] > 0 ? ` · ${Math.ceil(cds[1])}s` : ''}</span>`;
    } else {
      this.abilityHints.innerHTML = '<span>Busca cristales de poder por la isla</span>';
    }
    void snap;
  }

  updateSlot(index, slot, cd, active) {
    const el = this.slots[index];
    const meta = ELEMENTS[slot.e];
    const color = cssColor(meta.color);
    el.classList.remove('empty');
    el.classList.toggle('active', active);
    el.style.setProperty('--slot-color', color);
    el.style.setProperty('--slot-glow', rgba(meta.color, 0.18));
    el.style.setProperty('--slot-soft', rgba(meta.color, 0.14));
    el.style.setProperty('--slot-line', rgba(meta.color, 0.35));
    el.querySelector('.ps-key').textContent = String(index + 1);
    el.querySelector('.ps-icon').textContent = ICONS[slot.e];
    el.querySelector('.ps-name').textContent = meta.name;
    const rarity = RARITIES[slot.r] || RARITIES.common;
    el.querySelector('.ps-sub').textContent = `${rarity.name} · ${meta.abilities[0].name}`;
    const overlay = el.querySelector('.ps-cd');
    const remaining = Math.max(cd?.[0] || 0, cd?.[1] || 0);
    overlay.classList.toggle('show', remaining > 0);
    overlay.textContent = remaining > 0 ? Math.ceil(remaining) : '';
    overlay.style.background = `rgba(4, 7, 18, 0.68)`;
  }

  updateSlotEmpty(index) {
    const el = this.slots[index];
    el.classList.add('empty');
    el.classList.remove('active');
    el.style.removeProperty('--slot-color');
    el.style.removeProperty('--slot-glow');
    el.style.removeProperty('--slot-soft');
    el.style.removeProperty('--slot-line');
    el.querySelector('.ps-key').textContent = String(index + 1);
    el.querySelector('.ps-icon').textContent = '·';
    el.querySelector('.ps-name').textContent = 'Sin poder';
    el.querySelector('.ps-sub').textContent = index === 0 ? 'Clic izquierdo' : 'Clic derecho';
    const overlay = el.querySelector('.ps-cd');
    overlay.classList.remove('show');
    overlay.textContent = '';
  }

  setSpectate(name) {
    if (name) {
      this.spectate.innerHTML = '';
      this.spectate.append('Observando a ');
      const strong = document.createElement('strong');
      strong.textContent = name;
      this.spectate.append(strong);
      this.spectate.classList.remove('hidden');
    } else {
      this.spectate.classList.add('hidden');
    }
  }

  pushFeed(name, by, cause) {
    const item = document.createElement('div');
    item.className = 'feed-item';
    if (by) {
      const killer = document.createElement('strong');
      killer.textContent = by;
      const verb = document.createElement('span');
      verb.textContent = ' derrotó a ';
      const victim = document.createElement('span');
      victim.className = 'victim';
      victim.textContent = name;
      item.append(killer, verb, victim);
    } else {
      const victim = document.createElement('span');
      victim.className = 'victim';
      victim.textContent = name;
      const causeText = document.createElement('span');
      causeText.textContent = ` cayó por ${cause || 'la tormenta'}`;
      item.append(victim, causeText);
    }
    this.killfeed.prepend(item);
    while (this.killfeed.children.length > 5) this.killfeed.lastElementChild.remove();
    setTimeout(() => {
      item.style.opacity = '0';
      setTimeout(() => item.remove(), 500);
    }, 6000);
  }

  toast(text, color = '#f3c96b') {
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = text;
    item.style.setProperty('--toast-color', color);
    item.style.setProperty('--toast-glow', rgba(color, 0.22));
    this.toasts.appendChild(item);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild.remove();
    setTimeout(() => {
      item.classList.add('fade');
      setTimeout(() => item.remove(), 500);
    }, 2200);
  }

  setAim(x, y, color, visible) {
    this.aimCursor.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.aimCursor.style.transform = `translate(${x}px, ${y}px)`;
    if (color && color !== this.aimColor) {
      this.aimColor = color;
      this.aimCursor.style.setProperty('--aim-color', color);
      this.aimCursor.style.setProperty('--aim-glow', rgba(color, 0.45));
    }
  }

  flashDamage() {
    const el = this.damageFlash;
    el.style.transition = 'none';
    el.style.opacity = '0.9';
    clearTimeout(this.damageTimer);
    this.damageTimer = setTimeout(() => {
      el.style.transition = 'opacity 0.55s ease';
      el.style.opacity = '0';
    }, 40);
  }

  updateNameplates(entries) {
    const seen = new Set();
    for (const entry of entries) {
      seen.add(entry.id);
      let node = this.nameplates.get(entry.id);
      if (!node) {
        node = document.createElement('div');
        node.className = 'nameplate';
        const name = document.createElement('div');
        name.className = 'np-name';
        const bar = document.createElement('div');
        bar.className = 'np-bar';
        const fill = document.createElement('div');
        fill.className = 'np-fill';
        bar.appendChild(fill);
        node.append(name, bar);
        this.nameplateLayer.appendChild(node);
        this.nameplates.set(entry.id, { node, name, fill });
      }
      const parts = this.nameplates.get(entry.id);
      if (!parts.name.dataset.id) {
        parts.name.textContent = entry.name;
        if (entry.bot) {
          const bot = document.createElement('span');
          bot.textContent = ' · IA';
          bot.style.color = '#8e99bd';
          bot.style.fontSize = '8px';
          parts.name.appendChild(bot);
        }
        parts.name.dataset.id = '1';
      }
      if (!entry.visible) {
        parts.node.style.display = 'none';
        continue;
      }
      parts.node.style.display = 'flex';
      parts.node.style.transform = `translate(${entry.x}px, ${entry.y}px) translate(-50%, -100%)`;
      parts.fill.style.width = `${Math.max(0, Math.min(100, entry.hp))}%`;
    }
    for (const [id, parts] of this.nameplates) {
      if (seen.has(id)) continue;
      parts.node.remove();
      this.nameplates.delete(id);
    }
  }

  drawMinimap(snap) {
    const ctx = this.minimapContext;
    const size = this.minimap.width;
    const scale = size / WORLD_SIZE;
    if (this.minimapBg) {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(this.minimapBg, 0, 0, size, size);
    } else {
      ctx.fillStyle = '#152238';
      ctx.fillRect(0, 0, size, size);
    }
    const toMap = (x, z) => ({
      x: (x + HALF_WORLD) * scale,
      y: (z + HALF_WORLD) * scale,
    });
    const storm = snap.storm;
    if (storm) {
      // Zona oscura fuera de la tormenta.
      const center = toMap(storm.cx, storm.cz);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      const r = storm.r * scale;
      ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20, 6, 40, 0.52)';
      ctx.fill('evenodd');
      ctx.restore();

      if (storm.next) {
        const next = toMap(storm.next.x, storm.next.z);
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(143, 232, 255, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.arc(next.x, next.y, storm.next.r * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(189, 139, 255, 0.95)';
      ctx.lineWidth = 2;
      ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of snap.players) {
      if (!p.al) continue;
      const pos = toMap(p.x, p.z);
      if (p.i === this.selfId) {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(p.yaw || 0);
        ctx.beginPath();
        ctx.moveTo(0, -5.5);
        ctx.lineTo(4, 4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fillStyle = '#ffe08a';
        ctx.shadowColor = '#ffcf5e';
        ctx.shadowBlur = 9;
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 120, 120, 0.95)';
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('N', size - 12, 12);
  }

  formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}

export const hud = new HUD();
