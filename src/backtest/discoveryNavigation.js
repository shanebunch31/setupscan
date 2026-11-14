import React, { useEffect, useRef, useState } from 'react'

export const DISCOVERY_SECTIONS = Object.freeze([
  { id: 'discovery-overview', label: 'Overview' },
  { id: 'discovery-batch-a', label: 'Batch A' },
  { id: 'discovery-batch-b', label: 'Batch B' },
  { id: 'discovery-batch-c', label: 'Batch C' },
])

export const discoveryFamilyId = key => `discovery-family-${key}`

export function discoveryScrollContainer(element, win) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(win.getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent
  }
  return win
}

export function discoveryExpansion(root, open) {
  const details = [...root.querySelectorAll('.discovery-family-details')]
  if (typeof open === 'boolean') details.forEach(detail => { detail.open = open })
  return { total: details.length, open: details.filter(detail => detail.open).length }
}

export function revealDiscoveryTarget(root, id, win) {
  const target = root.ownerDocument.getElementById(id)
  if (!target || !root.contains(target)) return null
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (node.tagName === 'DETAILS') node.open = true
  }
  const focusTarget = target.tagName === 'DETAILS' ? target.querySelector('summary') : target
  focusTarget?.focus({ preventScroll: true })
  target.scrollIntoView({ behavior: win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  return target
}

export function activeDiscoverySection(sections, boundary) {
  let active = sections[0]?.id ?? null
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= boundary + 16) active = section.id
  }
  return active
}

export function useDiscoveryNavigation(rootRef, sections) {
  const [active, setActive] = useState('discovery-overview')
  const [expanded, setExpanded] = useState({ total: 0, open: 0 })
  const highlight = useRef(null)
  const sectionKey = sections.map(section => section.id).join('|')
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const win = root.ownerDocument.defaultView
    const scroll = discoveryScrollContainer(root, win)
    const header = root.ownerDocument.querySelector('.topbar')
    const nav = root.querySelector('.discovery-section-nav')
    let frame = null
    const measure = () => {
      frame = null
      const rootTop = scroll === win ? 0 : scroll.getBoundingClientRect().top
      const headerBottom = Math.max(rootTop, header?.getBoundingClientRect().bottom ?? 0)
      const navHeight = nav?.getBoundingClientRect().height ?? 0
      root.style.setProperty('--discovery-header-offset', `${headerBottom - rootTop}px`)
      root.style.setProperty('--discovery-scroll-offset', `${headerBottom - rootTop + navHeight + 16}px`)
      const targets = sectionKey.split('|').map(id => root.ownerDocument.getElementById(id)).filter(Boolean)
      setActive(activeDiscoverySection(targets, headerBottom + navHeight))
    }
    const schedule = () => { if (frame === null) frame = win.requestAnimationFrame(measure) }
    const toggled = () => { setExpanded(discoveryExpansion(root)); schedule() }
    scroll.addEventListener('scroll', schedule, { passive: true })
    win.addEventListener('resize', schedule)
    root.addEventListener('toggle', toggled, true)
    const observer = win.ResizeObserver ? new win.ResizeObserver(schedule) : null
    if (header) observer?.observe(header)
    if (nav) observer?.observe(nav)
    observer?.observe(root)
    toggled()
    return () => {
      scroll.removeEventListener('scroll', schedule)
      win.removeEventListener('resize', schedule)
      root.removeEventListener('toggle', toggled, true)
      observer?.disconnect()
      if (frame !== null) win.cancelAnimationFrame(frame)
      if (highlight.current) {
        win.clearTimeout(highlight.current.timer)
        highlight.current.target.classList.remove('discovery-arrival')
      }
    }
  }, [rootRef, sectionKey])
  return {
    active, expanded,
    expandAll(open) { setExpanded(discoveryExpansion(rootRef.current, open)) },
    navigate(event, id) {
      // Preserve normal browser behavior for modified link activation.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const root = rootRef.current, win = root.ownerDocument.defaultView
      const target = revealDiscoveryTarget(root, id, win)
      if (!target) return
      event.preventDefault()
      if (highlight.current) {
        win.clearTimeout(highlight.current.timer)
        highlight.current.target.classList.remove('discovery-arrival')
      }
      target.classList.add('discovery-arrival')
      highlight.current = { target, timer: win.setTimeout(() => target.classList.remove('discovery-arrival'), 1600) }
      setExpanded(discoveryExpansion(root))
      if (sections.some(section => section.id === id)) setActive(id)
    },
  }
}

export function DiscoverySectionNav({ sections, active, navigate }) {
  return React.createElement('nav', { className: 'discovery-section-nav', 'aria-label': 'Strategy Discovery sections' },
    sections.map(section => React.createElement('a', {
      key: section.id, href: `#${section.id}`, 'aria-current': active === section.id ? 'location' : undefined,
      onClick: event => navigate(event, section.id),
    }, section.label)))
}
