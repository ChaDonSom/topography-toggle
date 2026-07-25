;(function (global) {
  "use strict"

  function bindStickyHeadings(root, options) {
    if (!root) return function () {}

    var opts = options || {}
    var headingSelector = opts.headingSelector || "h1, h2, h3, h4, h5, h6"
    var stickyActiveAttr = opts.stickyActiveAttr || "data-sticky-active"
    var baseTopPx = Number.isFinite(opts.baseTopPx) ? opts.baseTopPx : 0
    var inputTarget = opts.inputTarget || null

    function headingLevel(tagName) {
      var match = /^H([1-6])$/.exec(tagName || "")
      return match ? Number(match[1]) : 0
    }

    function levelStickyTopFromActive(activeByLevel, level) {
      var top = baseTopPx
      for (var currentLevel = 1; currentLevel < level; currentLevel += 1) {
        var active = activeByLevel[currentLevel]
        if (!active) continue
        top += active.height
      }
      return top
    }

    function applyStickyTops(activeByLevel) {
      for (var level = 1; level <= 6; level += 1) {
        var top = levelStickyTopFromActive(activeByLevel, level)
        root.style.setProperty("--heading-sticky-top-" + level, top + "px")
      }
    }

    function collectHeadings() {
      var nodes = root.querySelectorAll(headingSelector)
      var headings = []

      nodes.forEach(function (node) {
        var level = headingLevel(node.tagName)
        if (!level) return
        var rect = node.getBoundingClientRect()
        headings.push({
          node: node,
          level: level,
          top: rect.top,
          height: Math.ceil(rect.height),
          index: headings.length,
        })
      })

      return headings
    }

    function resolveActiveByLevel(headings) {
      var activeByLevel = [null, null, null, null, null, null, null]

      for (var i = 0; i < headings.length; i += 1) {
        var heading = headings[i]
        var stickyTop = levelStickyTopFromActive(activeByLevel, heading.level)
        if (heading.top > stickyTop + 0.5) break

        activeByLevel[heading.level] = heading
        for (var childLevel = heading.level + 1; childLevel <= 6; childLevel += 1) {
          activeByLevel[childLevel] = null
        }
      }

      return activeByLevel
    }

    function resolveParentLevelByLevel(activeByLevel) {
      var parentLevelByLevel = [0, 0, 0, 0, 0, 0, 0]

      for (var level = 1; level <= 6; level += 1) {
        if (!activeByLevel[level]) continue
        parentLevelByLevel[level] = resolveNearestActiveAncestorLevel(activeByLevel, level)
      }

      return parentLevelByLevel
    }

    function resolveStackHeightByLevel(activeByLevel, parentLevelByLevel) {
      var stackHeightByLevel = [0, 0, 0, 0, 0, 0, 0]

      for (var level = 1; level <= 6; level += 1) {
        var heading = activeByLevel[level]
        if (!heading) continue
        stackHeightByLevel[level] = heading.height
      }

      for (var reverseLevel = 6; reverseLevel >= 1; reverseLevel -= 1) {
        var parentLevel = parentLevelByLevel[reverseLevel]
        if (!parentLevel) continue
        stackHeightByLevel[parentLevel] += stackHeightByLevel[reverseLevel]
      }

      return stackHeightByLevel
    }

    function resolvePushByHeading(headings, activeByLevel, parentLevelByLevel, stackHeightByLevel) {
      var pushByHeading = new Map()

      for (var level = 1; level <= 6; level += 1) {
        var heading = activeByLevel[level]
        if (!heading) continue

        var stackHeight = stackHeightByLevel[level] || heading.height
        var ownPush = resolveOwnPush(headings, activeByLevel, heading, stackHeight)
        var inheritedPush = resolveAncestorPush(activeByLevel, parentLevelByLevel, pushByHeading, level)
        pushByHeading.set(heading, Math.min(ownPush, inheritedPush))
      }

      return pushByHeading
    }

    function applyStickyState(headings, activeSet, pushByHeading) {
      headings.forEach(function (heading) {
        if (activeSet.has(heading)) heading.node.setAttribute(stickyActiveAttr, "true")
        else heading.node.removeAttribute(stickyActiveAttr)

        heading.node.style.transform = ""
        if (!activeSet.has(heading)) return

        var pushY = pushByHeading.get(heading) || 0
        if (pushY < 0) heading.node.style.transform = "translateY(" + pushY + "px)"
      })
    }

    function clearStickyState(headings) {
      headings.forEach(function (heading) {
        heading.node.removeAttribute(stickyActiveAttr)
        heading.node.style.transform = ""
      })
    }

    function resolveOwnPush(headings, activeByLevel, heading, stackHeight) {
      var stickyTop = levelStickyTopFromActive(activeByLevel, heading.level)
      var sectionEnd = nextSectionBoundaryIndex(headings, heading)
      var nextPeer = nextSameLevelHeading(headings, heading, sectionEnd)
      if (!nextPeer) return 0
      var outgoingBottom = stickyTop + stackHeight
      return Math.min(0, nextPeer.top - outgoingBottom)
    }

    function resolveNearestActiveAncestorLevel(activeByLevel, level) {
      for (var parentLevel = level - 1; parentLevel >= 1; parentLevel -= 1) {
        if (activeByLevel[parentLevel]) return parentLevel
      }
      return 0
    }

    function resolveAncestorPush(activeByLevel, parentLevelByLevel, pushByHeading, level) {
      var parentLevel = parentLevelByLevel[level]
      if (!parentLevel) return 0
      var parent = activeByLevel[parentLevel]
      if (!parent) return 0
      return pushByHeading.get(parent) || 0
    }

    function nextSectionBoundaryIndex(headings, current) {
      for (var i = current.index + 1; i < headings.length; i += 1) {
        if (headings[i].level < current.level) return i
      }
      return headings.length
    }

    function nextSameLevelHeading(headings, current, endIndex) {
      for (var i = current.index + 1; i < endIndex; i += 1) {
        if (headings[i].level === current.level) return headings[i]
      }
      return null
    }

    function update() {
      var headings = collectHeadings()
      if (root.classList.contains("is-topography-dragging") || root.classList.contains("is-topography-settling")) {
        clearStickyState(headings)
        return
      }

      var activeByLevel = resolveActiveByLevel(headings)
      applyStickyTops(activeByLevel)

      var activeSet = new Set(activeByLevel.filter(Boolean))
      var parentLevelByLevel = resolveParentLevelByLevel(activeByLevel)
      var stackHeightByLevel = resolveStackHeightByLevel(activeByLevel, parentLevelByLevel)
      var pushByHeading = resolvePushByHeading(headings, activeByLevel, parentLevelByLevel, stackHeightByLevel)

      applyStickyState(headings, activeSet, pushByHeading)
    }

    var rafId = 0
    function schedule() {
      if (rafId) return
      rafId = window.requestAnimationFrame(function () {
        rafId = 0
        update()
      })
    }

    var observer = new MutationObserver(function () {
      schedule()
    })
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, { passive: true })
    if (inputTarget && inputTarget.addEventListener) inputTarget.addEventListener("input", schedule)
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", schedule)

    schedule()

    return function () {
      observer.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule)
      if (inputTarget && inputTarget.removeEventListener) inputTarget.removeEventListener("input", schedule)
      if (document.fonts && document.fonts.removeEventListener)
        document.fonts.removeEventListener("loadingdone", schedule)
    }
  }

  global.StickyHeadings = { bindStickyHeadings: bindStickyHeadings }
})(window)
