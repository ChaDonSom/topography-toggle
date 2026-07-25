export function bindTopographyToggle(root, options) {
  if (!root) return function () {}

  var opts = options || {}
  var onProgress = typeof opts.onProgress === "function" ? opts.onProgress : function () {}

  var CONFIG = {
    LOCK_DISTANCE_PX: 8,
    LOCK_RATIO: 1.2,
    DRAG_FULL_DISTANCE_PX: 220,
    COMMIT_DISTANCE_PX: 42,
    VELOCITY_COMMIT: 0.35,
    SETTLE_DURATION_MS: 210,
    CANCEL_DURATION_MS: 150,
    ESCAPE_DURATION_MS: 140,
  }

  var state = {
    committed: 0,
    progress: 0,
    handles: [],
    segments: [],
    dragging: null,
    rafMeasureId: 0,
    rafSettleId: 0,
    resizeObserver: null,
    anchorLock: {
      active: false,
      anchor: null,
      spacerPx: 0,
      rafId: 0,
      pendingAnchor: null,
      htmlOverflowAnchor: "",
      bodyOverflowAnchor: "",
      rootOverflowAnchor: "",
      htmlScrollBehavior: "",
      bodyScrollBehavior: "",
    },
  }

  init()

  return function destroy() {
    unbindEvents()
    teardownObservers()
    cancelSettleAnimation()

    if (state.rafMeasureId) {
      window.cancelAnimationFrame(state.rafMeasureId)
      state.rafMeasureId = 0
    }

    endAnchorLock()
    clearHeadingTransforms()
  }

  function init() {
    wrapBodySegments()
    buildHandles()
    syncHandleState()
    bindEvents()
    setupObservers()
    queueMeasure()
  }

  function bindEvents() {
    root.addEventListener("pointerdown", onPointerDown)
    root.addEventListener("pointermove", onPointerMove)
    root.addEventListener("pointerup", onPointerUp)
    root.addEventListener("pointercancel", onPointerCancel)
    document.addEventListener("keydown", onEscape)
    window.addEventListener("resize", queueMeasure)

    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener("loadingdone", queueMeasure)
    }
  }

  function unbindEvents() {
    root.removeEventListener("pointerdown", onPointerDown)
    root.removeEventListener("pointermove", onPointerMove)
    root.removeEventListener("pointerup", onPointerUp)
    root.removeEventListener("pointercancel", onPointerCancel)
    document.removeEventListener("keydown", onEscape)
    window.removeEventListener("resize", queueMeasure)

    if (document.fonts && document.fonts.removeEventListener) {
      document.fonts.removeEventListener("loadingdone", queueMeasure)
    }
  }

  function setupObservers() {
    if (typeof ResizeObserver !== "function") return

    state.resizeObserver = new ResizeObserver(function () {
      queueMeasure()
    })

    state.resizeObserver.observe(root)
  }

  function teardownObservers() {
    if (!state.resizeObserver) return
    state.resizeObserver.disconnect()
    state.resizeObserver = null
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function isHeading(node) {
    return !!node && node.nodeType === 1 && /^H[1-6]$/.test(node.tagName)
  }

  function clearHeadingTransforms() {
    var headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6")
    headings.forEach(function (heading) {
      heading.style.transform = ""
    })
  }

  function createAnchor(headingNode) {
    if (!headingNode || !headingNode.isConnected) return null
    return {
      node: headingNode,
      lockY: headingNode.getBoundingClientRect().top,
    }
  }

  function getSegmentForHeading(headingNode) {
    if (!headingNode) return null

    // Segments are inserted before the next heading in wrapBodySegments,
    // so the segment affecting this heading sits immediately before it.
    var sibling = headingNode.previousElementSibling
    while (sibling && !sibling.hasAttribute("data-topography-segment")) {
      sibling = sibling.previousElementSibling
    }

    return sibling || null
  }

  function computeSpacerPx(anchor) {
    var headingNode = anchor && anchor.node ? anchor.node : null
    var segment = getSegmentForHeading(headingNode)

    if (!segment) return Math.ceil(window.innerHeight * 0.25)

    var measured = parseFloat(segment.style.getPropertyValue("--segment-height")) || 0
    if (!measured) measured = Math.ceil(segment.scrollHeight)

    return Math.max(measured, window.innerHeight * 0.25)
  }

  function applyAnchorSpacer(nextSpacerPx) {
    var current = state.anchorLock.spacerPx || 0
    var target = Math.max(0, Math.ceil(nextSpacerPx || 0))
    if (target <= current) return

    var delta = target - current
    state.anchorLock.spacerPx = target
    root.style.setProperty("--topography-anchor-spacer", target + "px")
    root.classList.add("has-topography-anchor-spacer")

    // Adding top padding shifts content down. Counter-scroll immediately.
    window.scrollTo(0, window.scrollY + delta)
  }

  function nudgeScrollToAnchor(anchor) {
    if (!anchor || !anchor.node || !anchor.node.isConnected) return

    var currentY = anchor.node.getBoundingClientRect().top
    var deltaY = currentY - anchor.lockY

    if (Math.abs(deltaY) < 0.25) return

    // Use an absolute target so tiny per-frame errors do not accumulate.
    var targetScrollY = clamp(
      window.scrollY + deltaY,
      0,
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    )

    window.scrollTo(0, targetScrollY)
  }

  function flushAnchorLockFrame() {
    state.anchorLock.rafId = 0
    var pendingAnchor = state.anchorLock.pendingAnchor
    state.anchorLock.pendingAnchor = null
    nudgeScrollToAnchor(pendingAnchor || state.anchorLock.anchor)
  }

  function keepAnchorLocked(anchor) {
    if (!state.anchorLock.active) return

    state.anchorLock.pendingAnchor = anchor || state.anchorLock.anchor || null
    if (!state.anchorLock.pendingAnchor) return

    // Correct immediately in the same frame as the progress update.
    nudgeScrollToAnchor(state.anchorLock.pendingAnchor)

    if (!state.anchorLock.rafId) {
      state.anchorLock.rafId = window.requestAnimationFrame(flushAnchorLockFrame)
    }
  }

  function beginAnchorLock(anchor) {
    if (state.anchorLock.active) {
      state.anchorLock.anchor = anchor || state.anchorLock.anchor
      applyAnchorSpacer(computeSpacerPx(state.anchorLock.anchor))
      keepAnchorLocked(state.anchorLock.anchor)
      return
    }

    state.anchorLock.active = true
    state.anchorLock.anchor = anchor || null
    state.anchorLock.htmlOverflowAnchor = document.documentElement.style.getPropertyValue("overflow-anchor")
    state.anchorLock.bodyOverflowAnchor = document.body.style.getPropertyValue("overflow-anchor")
    state.anchorLock.rootOverflowAnchor = root.style.getPropertyValue("overflow-anchor")
    state.anchorLock.htmlScrollBehavior = document.documentElement.style.getPropertyValue("scroll-behavior")
    state.anchorLock.bodyScrollBehavior = document.body.style.getPropertyValue("scroll-behavior")

    document.documentElement.style.setProperty("overflow-anchor", "none")
    document.body.style.setProperty("overflow-anchor", "none")
    root.style.setProperty("overflow-anchor", "none")
    document.documentElement.style.setProperty("scroll-behavior", "auto")
    document.body.style.setProperty("scroll-behavior", "auto")

    applyAnchorSpacer(computeSpacerPx(state.anchorLock.anchor))

    root.classList.add("is-topography-anchor-lock")
    nudgeScrollToAnchor(state.anchorLock.anchor)
  }

  function endAnchorLock() {
    if (!state.anchorLock.active) return

    if (state.anchorLock.rafId) {
      window.cancelAnimationFrame(state.anchorLock.rafId)
      state.anchorLock.rafId = 0
    }
    state.anchorLock.pendingAnchor = null

    if (state.anchorLock.htmlOverflowAnchor) {
      document.documentElement.style.setProperty("overflow-anchor", state.anchorLock.htmlOverflowAnchor)
    } else {
      document.documentElement.style.removeProperty("overflow-anchor")
    }

    if (state.anchorLock.bodyOverflowAnchor) {
      document.body.style.setProperty("overflow-anchor", state.anchorLock.bodyOverflowAnchor)
    } else {
      document.body.style.removeProperty("overflow-anchor")
    }

    if (state.anchorLock.rootOverflowAnchor) {
      root.style.setProperty("overflow-anchor", state.anchorLock.rootOverflowAnchor)
    } else {
      root.style.removeProperty("overflow-anchor")
    }

    if (state.anchorLock.htmlScrollBehavior) {
      document.documentElement.style.setProperty("scroll-behavior", state.anchorLock.htmlScrollBehavior)
    } else {
      document.documentElement.style.removeProperty("scroll-behavior")
    }

    if (state.anchorLock.bodyScrollBehavior) {
      document.body.style.setProperty("scroll-behavior", state.anchorLock.bodyScrollBehavior)
    } else {
      document.body.style.removeProperty("scroll-behavior")
    }

    var spacerPx = state.anchorLock.spacerPx || 0
    root.classList.remove("has-topography-anchor-spacer")
    root.style.setProperty("--topography-anchor-spacer", "0px")
    if (spacerPx) {
      window.scrollTo(0, Math.max(0, window.scrollY - spacerPx))
    }

    root.classList.remove("is-topography-anchor-lock")

    state.anchorLock.active = false
    state.anchorLock.anchor = null
    state.anchorLock.spacerPx = 0
    state.anchorLock.htmlOverflowAnchor = ""
    state.anchorLock.bodyOverflowAnchor = ""
    state.anchorLock.rootOverflowAnchor = ""
    state.anchorLock.htmlScrollBehavior = ""
    state.anchorLock.bodyScrollBehavior = ""
  }

  function setProgress(next) {
    state.progress = clamp(next, 0, 1)
    root.style.setProperty("--topography-progress", String(state.progress))
    root.setAttribute(
      "data-topography-mode",
      state.progress >= 1 ? "collapsed" : state.progress <= 0 ? "open" : "mixed",
    )
    onProgress(state.progress)
  }

  function setCommitted(target) {
    state.committed = target >= 0.5 ? 1 : 0
  }

  function syncHandleState() {
    var collapsed = state.committed === 1
    state.handles.forEach(function (button) {
      button.setAttribute("aria-pressed", collapsed ? "true" : "false")
      button.setAttribute("aria-label", collapsed ? "Expand article body" : "Collapse article body")
      button.setAttribute("title", collapsed ? "Expand article body" : "Collapse article body")
    })
  }

  function vibrateIfPossible() {
    var canVibrate =
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function" &&
      typeof window.matchMedia === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (!canVibrate) return
    navigator.vibrate(8)
  }

  function cancelSettleAnimation(options) {
    var opts = options || {}
    var preserveAnchorLock = !!opts.preserveAnchorLock

    if (state.rafSettleId) {
      window.cancelAnimationFrame(state.rafSettleId)
      state.rafSettleId = 0
    }

    root.classList.remove("is-topography-settling")
    if (!preserveAnchorLock) endAnchorLock()
  }

  function animateTo(
    target, // 0-1
    durationMs,
    options,
  ) {
    cancelSettleAnimation({ preserveAnchorLock: true })

    var opts = options || {}
    var shouldCommit = !!opts.commit
    var shouldVibrate = !!opts.vibrate
    var anchor = opts.anchor || null

    if (anchor) {
      beginAnchorLock(anchor)
      keepAnchorLocked(anchor)
    }

    var from = clamp(state.progress, 0, 1)
    var delta = target - from // -1 to 1
    var startedAt = 0

    if (Math.abs(delta) < 0.001) {
      setProgress(target)
      if (shouldCommit) setCommitted(target)
      syncHandleState()
      if (anchor) nudgeScrollToAnchor(anchor)
      endAnchorLock()
      if (shouldVibrate) vibrateIfPossible()
      return
    }

    root.classList.add("is-topography-settling")

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3)
    }

    function tick(ts) {
      if (!startedAt) startedAt = ts

      var elapsed = ts - startedAt
      var t = clamp(elapsed / durationMs, 0, 1)
      var eased = easeOutCubic(t)

      setProgress(from + delta * eased)
      if (anchor) keepAnchorLocked(anchor)

      if (t < 1) {
        state.rafSettleId = window.requestAnimationFrame(tick)
        return
      }

      state.rafSettleId = 0
      setProgress(target)
      if (anchor) nudgeScrollToAnchor(anchor)

      if (shouldCommit) setCommitted(target)
      syncHandleState()
      endAnchorLock()
      if (shouldVibrate) vibrateIfPossible()

      setTimeout(() => root.classList.remove("is-topography-settling"), 50)
    }

    state.rafSettleId = window.requestAnimationFrame(tick)
  }

  function toggleFromHandle(headingNode) {
    var target = state.committed === 1 ? 0 : 1
    var anchor = createAnchor(headingNode)

    animateTo(target, CONFIG.SETTLE_DURATION_MS, {
      commit: true,
      vibrate: true,
      anchor: anchor,
    })
  }

  function queueMeasure() {
    if (state.rafMeasureId) return
    if (root.classList.contains("is-topography-settling")) return

    state.rafMeasureId = window.requestAnimationFrame(function () {
      measureSegments()
      state.rafMeasureId = 0
      measureSegments()
    })
  }

  function measureSegments() {
    state.segments.forEach(function (segment) {
      segment.style.removeProperty("--segment-height")
    })

    state.segments.forEach(function (segment) {
      var height = Math.ceil(segment.scrollHeight)
      segment.style.setProperty("--segment-height", height + "px")
    })

    setProgress(state.progress)
  }

  function wrapBodySegments() {
    var childNodes = Array.prototype.slice.call(root.childNodes)
    var pending = []
    var collected = []

    function flush(beforeNode) {
      if (!pending.length) return

      var segment = document.createElement("div")
      segment.className = "topography-segment"
      segment.setAttribute("data-topography-segment", "")

      var inner = document.createElement("div")
      inner.className = "topography-segment__inner"
      segment.appendChild(inner)

      pending.forEach(function (node) {
        inner.appendChild(node)
      })

      root.insertBefore(segment, beforeNode || null)
      collected.push(segment)
      pending = []
    }

    childNodes.forEach(function (node) {
      if (isHeading(node)) {
        flush(node)
        return
      }

      if (node.nodeType === 3 && !node.textContent.trim()) {
        pending.push(node)
        return
      }

      pending.push(node)
    })

    flush(null)
    state.segments = collected
  }

  function buildHandles() {
    var headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6")
    state.handles = []

    headings.forEach(function (heading) {
      var existing = heading.querySelector(".topography-handle")
      if (existing) {
        state.handles.push(existing)
        return
      }

      var handle = document.createElement("button")
      handle.type = "button"
      handle.className = "topography-handle"
      handle.setAttribute("aria-pressed", "false")
      handle.setAttribute("aria-label", "Collapse article body")
      handle.setAttribute("title", "Collapse article body")

      handle.addEventListener("click", function (event) {
        event.preventDefault()
        toggleFromHandle(heading)
      })

      handle.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        toggleFromHandle(heading)
      })

      heading.appendChild(handle)
      state.handles.push(handle)
    })
  }

  function shouldTrackGesture(pointerType, target) {
    if (pointerType === "mouse") return false
    if (!target) return false
    if (target.closest(".topography-handle")) return false
    return !!target.closest("h1, h2, h3, h4, h5, h6")
  }

  function releasePointerCaptureSafe(dragState, pointerId) {
    if (!dragState || !dragState.headingNode) return
    var headingNode = dragState.headingNode

    if (!headingNode.releasePointerCapture || !headingNode.hasPointerCapture) return
    if (!headingNode.hasPointerCapture(pointerId)) return

    headingNode.releasePointerCapture(pointerId)
  }

  function clearDragState(pointerId) {
    var dragState = state.dragging
    if (!dragState) return null

    releasePointerCaptureSafe(dragState, pointerId)
    state.dragging = null
    root.classList.remove("is-topography-dragging")
    return dragState
  }

  function onPointerDown(event) {
    if (!shouldTrackGesture(event.pointerType, event.target)) return

    cancelSettleAnimation()
    clearHeadingTransforms()

    var headingNode = event.target.closest("h1, h2, h3, h4, h5, h6")

    state.dragging = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startProgress: state.progress,
      startCommitted: state.committed,
      lastX: event.clientX,
      lastT: event.timeStamp,
      velocityX: 0,
      locked: false,
      headingNode: headingNode,
      anchor: createAnchor(headingNode),
    }

    if (headingNode && headingNode.setPointerCapture) {
      headingNode.setPointerCapture(event.pointerId)
    }
  }

  function onPointerMove(event) {
    var dragState = state.dragging
    if (!dragState || event.pointerId !== dragState.pointerId) return

    var dx = event.clientX - dragState.startX
    var dy = event.clientY - dragState.startY

    var dt = event.timeStamp - dragState.lastT
    if (dt > 0) {
      dragState.velocityX = (event.clientX - dragState.lastX) / dt
    }
    dragState.lastX = event.clientX
    dragState.lastT = event.timeStamp

    if (!dragState.locked) {
      if (Math.abs(dx) < CONFIG.LOCK_DISTANCE_PX) return

      if (Math.abs(dx) <= Math.abs(dy) * CONFIG.LOCK_RATIO) {
        clearDragState(event.pointerId)
        return
      }

      dragState.locked = true
      root.classList.add("is-topography-dragging")
      beginAnchorLock(dragState.anchor)
    }

    event.preventDefault()

    var next = dragState.startProgress + dx / CONFIG.DRAG_FULL_DISTANCE_PX
    setProgress(next)
    keepAnchorLocked(dragState.anchor)
    syncHandleState()
  }

  function onPointerUp(event) {
    var dragState = state.dragging
    if (!dragState || event.pointerId !== dragState.pointerId) return

    clearDragState(event.pointerId)
    if (!dragState.locked) {
      endAnchorLock()
      return
    }

    var totalDx = event.clientX - dragState.startX
    var absDx = Math.abs(totalDx)
    var absVx = Math.abs(dragState.velocityX)
    var committed = absDx >= CONFIG.COMMIT_DISTANCE_PX || absVx >= CONFIG.VELOCITY_COMMIT

    if (committed) {
      var target = totalDx > 0 || dragState.velocityX > 0 ? 1 : 0
      animateTo(target, CONFIG.SETTLE_DURATION_MS, {
        commit: true,
        vibrate: true,
        anchor: dragState.anchor,
      })
      return
    }

    animateTo(dragState.startCommitted, CONFIG.CANCEL_DURATION_MS, {
      commit: false,
      vibrate: false,
      anchor: dragState.anchor,
    })
  }

  function onPointerCancel(event) {
    var dragState = state.dragging
    if (!dragState || event.pointerId !== dragState.pointerId) return

    clearDragState(event.pointerId)

    animateTo(dragState.startCommitted, CONFIG.CANCEL_DURATION_MS, {
      commit: false,
      vibrate: false,
      anchor: dragState.anchor,
    })
  }

  function onEscape(event) {
    if (event.key !== "Escape") return
    if (!state.dragging && !state.rafSettleId) return

    var dragState = state.dragging
    if (dragState) clearDragState(dragState.pointerId)

    animateTo(state.committed, CONFIG.ESCAPE_DURATION_MS, {
      commit: false,
      vibrate: false,
      anchor: dragState && dragState.locked ? dragState.anchor : null,
    })
  }
}
