export function bindStickyHeadings(root, options = {}) {
  if (!root) return () => {}

  const headingSelector = options.headingSelector || "h1, h2, h3, h4, h5, h6"
  const stickyActiveAttr = options.stickyActiveAttr || "data-sticky-active"
  const baseTopPx = Number.isFinite(options.baseTopPx) ? options.baseTopPx : 0
  const inputTarget = options.inputTarget || null

  function headingLevel(tagName) {
    const match = /^H([1-6])$/.exec(tagName || "")
    return match ? Number(match[1]) : 0
  }

  function levelStickyTopFromActive(activeByLevel, level) {
    let top = baseTopPx
    for (let currentLevel = 1; currentLevel < level; currentLevel += 1) {
      const active = activeByLevel[currentLevel]
      if (!active) continue
      top += active.height
    }
    return top
  }

  function applyStickyTops(activeByLevel) {
    for (let level = 1; level <= 6; level += 1) {
      const top = levelStickyTopFromActive(activeByLevel, level)
      root.style.setProperty(`--heading-sticky-top-${level}`, `${top}px`)
    }
  }

  function collectHeadings() {
    const nodes = root.querySelectorAll(headingSelector)
    const headings = []

    for (const node of nodes) {
      const level = headingLevel(node.tagName)
      if (!level) continue
      const rect = node.getBoundingClientRect()
      headings.push({
        node,
        level,
        top: rect.top,
        height: Math.ceil(rect.height),
        index: headings.length,
      })
    }

    return headings
  }

  function resolveActiveByLevel(headings) {
    const activeByLevel = [null, null, null, null, null, null, null]

    for (const heading of headings) {
      const stickyTop = levelStickyTopFromActive(activeByLevel, heading.level)
      if (heading.top > stickyTop + 0.5) break

      activeByLevel[heading.level] = heading
      for (let childLevel = heading.level + 1; childLevel <= 6; childLevel += 1) {
        activeByLevel[childLevel] = null
      }
    }

    return activeByLevel
  }

  function resolveParentLevelByLevel(activeByLevel) {
    const parentLevelByLevel = [0, 0, 0, 0, 0, 0, 0]

    for (let level = 1; level <= 6; level += 1) {
      if (!activeByLevel[level]) continue
      parentLevelByLevel[level] = resolveNearestActiveAncestorLevel(activeByLevel, level)
    }

    return parentLevelByLevel
  }

  function resolveStackHeightByLevel(activeByLevel, parentLevelByLevel) {
    const stackHeightByLevel = [0, 0, 0, 0, 0, 0, 0]

    for (let level = 1; level <= 6; level += 1) {
      const heading = activeByLevel[level]
      if (!heading) continue
      stackHeightByLevel[level] = heading.height
    }

    for (let level = 6; level >= 1; level -= 1) {
      const parentLevel = parentLevelByLevel[level]
      if (!parentLevel) continue
      stackHeightByLevel[parentLevel] += stackHeightByLevel[level]
    }

    return stackHeightByLevel
  }

  function resolvePushByHeading(headings, activeByLevel, parentLevelByLevel, stackHeightByLevel) {
    const pushByHeading = new Map()

    for (let level = 1; level <= 6; level += 1) {
      const heading = activeByLevel[level]
      if (!heading) continue

      const stackHeight = stackHeightByLevel[level] || heading.height
      const ownPush = resolveOwnPush(headings, activeByLevel, heading, stackHeight)
      const inheritedPush = resolveAncestorPush(activeByLevel, parentLevelByLevel, pushByHeading, level)
      pushByHeading.set(heading, Math.min(ownPush, inheritedPush))
    }

    return pushByHeading
  }

  function applyStickyState(headings, activeSet, pushByHeading) {
    for (const heading of headings) {
      if (activeSet.has(heading)) heading.node.setAttribute(stickyActiveAttr, "true")
      else heading.node.removeAttribute(stickyActiveAttr)

      heading.node.style.transform = ""
      if (!activeSet.has(heading)) continue

      const pushY = pushByHeading.get(heading) ?? 0
      if (pushY < 0) heading.node.style.transform = `translateY(${pushY}px)`
    }
  }

  function clearStickyState(headings) {
    for (const heading of headings) {
      heading.node.removeAttribute(stickyActiveAttr)
      heading.node.style.transform = ""
    }
  }

  function resolveOwnPush(headings, activeByLevel, heading, stackHeight) {
    const stickyTop = levelStickyTopFromActive(activeByLevel, heading.level)
    const sectionEnd = nextSectionBoundaryIndex(headings, heading)
    const nextPeer = nextSameLevelHeading(headings, heading, sectionEnd)
    if (!nextPeer) return 0
    const outgoingBottom = stickyTop + stackHeight
    return Math.min(0, nextPeer.top - outgoingBottom)
  }

  function resolveNearestActiveAncestorLevel(activeByLevel, level) {
    for (let parentLevel = level - 1; parentLevel >= 1; parentLevel -= 1) {
      if (activeByLevel[parentLevel]) return parentLevel
    }
    return 0
  }

  function resolveAncestorPush(activeByLevel, parentLevelByLevel, pushByHeading, level) {
    const parentLevel = parentLevelByLevel[level]
    if (!parentLevel) return 0
    const parent = activeByLevel[parentLevel]
    if (!parent) return 0
    return pushByHeading.get(parent) ?? 0
  }

  function nextSectionBoundaryIndex(headings, current) {
    for (let i = current.index + 1; i < headings.length; i += 1) {
      if (headings[i].level < current.level) return i
    }
    return headings.length
  }

  function nextSameLevelHeading(headings, current, endIndex) {
    for (let i = current.index + 1; i < endIndex; i += 1) {
      if (headings[i].level === current.level) return headings[i]
    }
    return null
  }

  function update() {
    const headings = collectHeadings()
    if (root.classList.contains("is-topography-dragging") || root.classList.contains("is-topography-settling")) {
      clearStickyState(headings)
      return
    }

    const activeByLevel = resolveActiveByLevel(headings)
    applyStickyTops(activeByLevel)

    const activeSet = new Set(activeByLevel.filter(Boolean))
    const parentLevelByLevel = resolveParentLevelByLevel(activeByLevel)
    const stackHeightByLevel = resolveStackHeightByLevel(activeByLevel, parentLevelByLevel)
    const pushByHeading = resolvePushByHeading(headings, activeByLevel, parentLevelByLevel, stackHeightByLevel)

    applyStickyState(headings, activeSet, pushByHeading)
  }

  let rafId = 0
  const schedule = () => {
    if (rafId) return
    rafId = window.requestAnimationFrame(() => {
      rafId = 0
      update()
    })
  }

  const observer = new MutationObserver(() => schedule())
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  window.addEventListener("resize", schedule)
  window.addEventListener("scroll", schedule, { passive: true })
  inputTarget?.addEventListener?.("input", schedule)
  document.fonts?.addEventListener?.("loadingdone", schedule)

  schedule()

  return () => {
    observer.disconnect()
    window.removeEventListener("resize", schedule)
    window.removeEventListener("scroll", schedule)
    inputTarget?.removeEventListener?.("input", schedule)
    document.fonts?.removeEventListener?.("loadingdone", schedule)
  }
}
