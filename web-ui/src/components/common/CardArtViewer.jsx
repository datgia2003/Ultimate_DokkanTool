import React, { useState, useRef, useEffect } from 'react'
import { Image, Shield, Swords, Heart, RefreshCw, ChevronLeft } from 'lucide-react'
import { RarityBadge, ElementBadge } from './CardBadge'
import { getElementMeta } from '../../types'
import { MusicWave } from '../player/MusicWave'

export function CardArtViewer({ card, onToggleCollapse }) {
  const [currentFace, setCurrentFace] = useState('anim') // 'anim' or 'art'
  const iframeRef = useRef(null)
  const isLr = card?.rarity === 5

  const cidStr = String(card?.id || '')
  const folderId = cidStr.length > 1 ? cidStr.slice(0, -1) + '0' : cidStr
  const lwfUrl = `/lwf-player/index.html?card_id=${card?.id}&folder_id=${folderId}&is_lr=${isLr ? 1 : 0}&port=8585&name=${encodeURIComponent(card?.name || '')}&element_color=${encodeURIComponent(getElementMeta(card?.element).color)}`

  useEffect(() => {
    const handleMsg = (event) => {
      if (event?.data?.type === 'dokkan:faceChanged') {
        setCurrentFace(event.data.face || (event.data.isFlipped ? 'art' : 'anim'))
      }
    }
    window.addEventListener('message', handleMsg)
    return () => window.removeEventListener('message', handleMsg)
  }, [])

  useEffect(() => {
    const frame = iframeRef.current
    if (!frame || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(([entry]) => {
      frame.contentWindow?.postMessage({
        type: 'dokkan:setVisibility',
        visible: entry.isIntersecting && entry.intersectionRatio > 0.02
      }, '*')
    }, { threshold: [0, 0.02] })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [card?.id])

  const handleToggleFlip = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'dokkan:flip' }, '*')
    }
  }

  if (!card) return null

  return (
    <div className="card-art-box persistent-panel">
      {/* Header & Swap Button on Top */}
      <div className="art-box-header">
        <button type="button" className="card-art-collapse-btn" onClick={onToggleCollapse}
          title="Ẩn Card Art" aria-label="Ẩn Card Art">
          <ChevronLeft size={15} />
        </button>

        {/* Swap Button on Top Header instead of side button */}
        {isLr ? (
          <button
            className="art-swap-top-btn"
            onClick={handleToggleFlip}
            title="Click to Flip Card (3D Live Anim ↔ HD Static Art)"
          >
            <RefreshCw size={12} />
            <span>{currentFace === 'anim' ? 'Live Anim' : 'Static Art'}</span>
          </button>
        ) : (
          <span className="art-type-badge">
            <Image size={12} /> HD Art
          </span>
        )}
      </div>

      {/* Centered Art Stage */}
      <div className="art-display-stage">
        <div className="lwf-player-wrapper">
          <iframe
            ref={iframeRef}
            key={`${card.id}_lwf`}
            src={lwfUrl}
            title="Dokkan LWF Card Player"
            className="lwf-iframe"
            onLoad={() => {
              const frame = iframeRef.current
              const rect = frame?.getBoundingClientRect()
              frame?.contentWindow?.postMessage({
                type: 'dokkan:setVisibility',
                visible: !document.hidden && !!rect && rect.width > 0 && rect.height > 0 &&
                  rect.bottom > 0 && rect.top < window.innerHeight
              }, '*')
            }}
          />
        </div>
      </div>

      <MusicWave className="art-music-wave" />

      {/* Mini Visual Quick Info */}
      <div className="art-mini-footer">
        <div className="art-tags-row">
          <RarityBadge rarity={card.rarity} />
          <ElementBadge element={card.element} />
          <span className="card-id-tag">#{card.id}</span>
        </div>
        <div className="art-mini-stats">
          <span><Heart size={11} /> {Number(card.hp_max || 0).toLocaleString()}</span>
          <span><Swords size={11} /> {Number(card.atk_max || 0).toLocaleString()}</span>
          <span><Shield size={11} /> {Number(card.def_max || 0).toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
