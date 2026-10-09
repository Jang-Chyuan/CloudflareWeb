import React from 'react';
import { dogColor, dogName, formatTime } from '../tracking/telemetry';
import { environmentLabel } from '../ml/Environment';

export function Metrics({ dog }) {
  return <div className="dog-metrics">
    <div><span>速度</span><strong>{Number.isFinite(dog.speed) ? dog.speed.toFixed(1) : '—'} <small>km/h</small></strong></div>
    <div><span>電量</span><strong className={dog.battery != null && dog.battery < 20 ? 'low-battery' : ''}>{Number.isFinite(dog.battery) ? `${dog.battery}%` : '—'}</strong></div>
  </div>;
}

export default function DogCard({ dog, aliases, hidden, following, onFollow, onToggle, onDetails, now }) {
  const name = dogName(dog.id, aliases);
  return <article className={`dog-card ${following ? 'following' : ''} ${hidden ? 'dog-hidden' : ''}`}>
    <div className="dog-card-top"><span className="dog-avatar" style={{ background: `${dogColor(dog.id)}18`, color: dogColor(dog.id) }}>🐕</span>
      <button className="dog-title" onClick={onDetails}><strong>{name}</strong><span>經 Master {dog.masterId} · 雲端</span></button>
      <button className="icon-button" aria-label={`${hidden ? '顯示' : '隱藏'}${name}位置`} aria-pressed={!hidden} onClick={onToggle}>{hidden ? '◌' : '◎'}</button>
    </div>
    <div className="dog-status"><i className={dog.stale ? 'offline-dot' : 'online-dot'} />{dog.status}{dog.retained && <span>最後有效位置</span>}</div>
    <Metrics dog={dog} />
    <dl className="dog-times"><div><dt>最後封包</dt><dd>{formatTime(dog.lastPacketAt)}</dd></div><div><dt>有效定位</dt><dd>{formatTime(dog.lastPositionAt)}</dd></div></dl>
    <p className="environment">目前環境：{environmentLabel(dog.environment, now)}</p>
    {dog.fixedReason && <p className="fixed-note">設定位置：{dog.fixedName} · {dog.fixedReason}</p>}
    {dog.stale && <p className="warning">尚無可顯示位置，或超過 3 分鐘未收到封包。</p>}
    <div className="dog-actions"><button disabled={dog.stale || !dog.position || hidden} className={following ? 'active-follow' : ''} onClick={onFollow}>{following ? '取消跟隨' : '地圖跟隨'}</button><button onClick={onDetails}>詳細資訊 ↗</button></div>
  </article>;
}
