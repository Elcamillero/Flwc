import { useEffect, useRef } from 'react'

type FootballEvoBroadcastProps = {
  homeStrength: number
  awayStrength: number
  homeLineup: BroadcastPlayer[]
  awayLineup: BroadcastPlayer[]
  homeName: string
  awayName: string
  isRunning: boolean
  matchMinute: number
  onScore: (side: 'home' | 'away') => void
}

type BroadcastPlayer = {
  name: string
  number: number
  position: string
}

type SimPlayer = {
  x: number
  y: number
  vx: number
  vy: number
  home: boolean
  role: 'GK' | 'DF' | 'MF' | 'FW'
  baseX: number
  baseY: number
  label: string
  number: number
  // run system
  runTargetX: number | null
  runTargetY: number | null
  runTimer: number   // frames until next run trigger
  isSprinting: boolean
}

const homeShape: Array<[number, number, SimPlayer['role']]> = [
  [0.08, 0.5, 'GK'],
  [0.2, 0.19, 'DF'],
  [0.2, 0.38, 'DF'],
  [0.2, 0.62, 'DF'],
  [0.2, 0.81, 'DF'],
  [0.39, 0.28, 'MF'],
  [0.37, 0.5, 'MF'],
  [0.39, 0.72, 'MF'],
  [0.62, 0.26, 'FW'],
  [0.67, 0.5, 'FW'],
  [0.62, 0.74, 'FW'],
]

const awayShape = homeShape.map(([x, y, role]) => [1 - x, y, role] as [number, number, SimPlayer['role']])

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function seededNoise(value: number) {
  const raw = Math.sin(value * 12.9898) * 43758.5453
  return raw - Math.floor(raw)
}

function drawPitch(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const margin = Math.max(26, Math.min(width, height) * 0.055)
  const fieldX = margin
  const fieldY = margin
  const fieldW = width - margin * 2
  const fieldH = height - margin * 2

  const grass = ctx.createLinearGradient(0, 0, width, height)
  grass.addColorStop(0, '#071d33')
  grass.addColorStop(0.5, '#0a3d4e')
  grass.addColorStop(1, '#06152b')
  ctx.fillStyle = grass
  ctx.fillRect(0, 0, width, height)

  for (let i = 0; i < 9; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,200,255,0.035)'
    ctx.fillRect(fieldX + (fieldW / 9) * i, fieldY, fieldW / 9, fieldH)
  }

  ctx.strokeStyle = 'rgba(205,238,255,0.72)'
  ctx.lineWidth = 2
  ctx.shadowColor = 'rgba(0,200,255,0.45)'
  ctx.shadowBlur = 12
  ctx.strokeRect(fieldX, fieldY, fieldW, fieldH)

  ctx.beginPath()
  ctx.moveTo(width / 2, fieldY)
  ctx.lineTo(width / 2, fieldY + fieldH)
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.13, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeRect(fieldX, height * 0.31, fieldW * 0.13, height * 0.38)
  ctx.strokeRect(width - fieldX - fieldW * 0.13, height * 0.31, fieldW * 0.13, height * 0.38)
  ctx.shadowBlur = 0
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  circle: HTMLImageElement,
  player: SimPlayer,
  color: string,
  accent: string,
  selected: boolean,
) {
  const scale = clamp(ctx.canvas.clientWidth / 760, 0.82, 1.25)
  const radius = (selected ? 10 : 8) * scale
  ctx.save()
  ctx.shadowColor = accent
  ctx.shadowBlur = selected ? 22 : 12
  ctx.drawImage(circle, player.x - radius, player.y - radius, radius * 2, radius * 2)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = color
  ctx.fillRect(player.x - radius, player.y - radius, radius * 2, radius * 2)
  ctx.restore()

  ctx.beginPath()
  ctx.strokeStyle = accent
  ctx.lineWidth = selected ? 2.2 : 1.4
  ctx.arc(player.x, player.y, radius + 2, 0, Math.PI * 2)
  ctx.stroke()

  ctx.font = selected ? `800 ${10 * scale}px Inter, sans-serif` : `800 ${9 * scale}px Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const label = `${player.number} ${player.label}`
  const labelY = player.y - radius - 11 * scale
  const textWidth = Math.min(92 * scale, ctx.measureText(label).width + 10 * scale)
  ctx.fillStyle = 'rgba(2,7,18,0.76)'
  ctx.fillRect(player.x - textWidth / 2, labelY - 8 * scale, textWidth, 15 * scale)
  ctx.strokeStyle = selected ? 'rgba(255,255,255,0.76)' : 'rgba(0,200,255,0.34)'
  ctx.lineWidth = 1
  ctx.strokeRect(player.x - textWidth / 2, labelY - 8 * scale, textWidth, 15 * scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, player.x, labelY)
}

function teamStrengthFor(home: boolean, homeStrength: number, awayStrength: number) {
  return home ? homeStrength : awayStrength
}

export function FootballEvoBroadcast({
  homeStrength,
  awayStrength,
  homeLineup,
  awayLineup,
  homeName,
  awayName,
  isRunning,
  matchMinute,
  onScore,
}: FootballEvoBroadcastProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const onScoreRef = useRef(onScore)

  useEffect(() => {
    onScoreRef.current = onScore
  }, [onScore])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    const circle = new Image()
    circle.src = '/footballevo/spritesheet.png'

    let frame = 0
    let animation = 0
    let possessionHome = homeStrength >= awayStrength
    let holderIndex = possessionHome ? 6 : 17
    let targetIndex = holderIndex
    let passProgress = 1
    let lastGoalFrame = -999
    let lastShotFrame = -999
    let actionCooldown = 90
    let completedPasses = 0
    let shotInFlight = false
    let eventText = 'TACTICAL BUILD-UP'
    const lineup = [...homeLineup, ...awayLineup]
    const players: SimPlayer[] = [...homeShape, ...awayShape].map(([baseX, baseY, role], index) => {
      const player = lineup[index] ?? {
        name: index < 11 ? `Home ${index + 1}` : `Away ${index - 10}`,
        number: index < 11 ? index + 1 : index - 10,
        position: role,
      }

      return {
        x: baseX * 640,
        y: baseY * 420,
        vx: 0,
        vy: 0,
        home: index < 11,
        role,
        baseX,
        baseY,
        label: player.name.split(' ').at(-1)?.slice(0, 11).toUpperCase() ?? player.position,
        number: player.number,
        runTargetX: null,
        runTargetY: null,
        runTimer: Math.floor(seededNoise(index * 17) * 60),
        isSprinting: false,
      }
    })
    const ball = { x: 320, y: 210, vx: 0, vy: 0 }
    const trail: Array<{ x: number; y: number }> = []

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    window.addEventListener('resize', resize)

    const choosePass = () => {
      const holder = players[holderIndex]
      const attackingRight = holder.home
      const strength = teamStrengthFor(holder.home, homeStrength, awayStrength)
      const team = players
        .map((player, index) => ({ player, index }))
        .filter(({ player, index }) => player.home === holder.home && index !== holderIndex)

      const forwardBias = 0.38 + (strength - 75) / 80
      const options = team
        .map((option) => {
          const px = option.player.runTargetX ?? option.player.x
          const progress = attackingRight
            ? (px / canvas.clientWidth) - (holder.x / canvas.clientWidth)
            : (holder.x / canvas.clientWidth) - (px / canvas.clientWidth)
          const lane = 1 - Math.abs(option.player.y - holder.y) / canvas.clientHeight
          const roleBoost = option.player.role === 'FW' ? 0.22 : option.player.role === 'MF' ? 0.1 : 0
          // bonus for players actively running into space
          const sprintBonus = option.player.isSprinting ? 0.28 : 0
          const noise = seededNoise(frame + option.index * 37) * 0.18
          return {
            ...option,
            score: lane + progress * forwardBias + roleBoost + sprintBonus + noise,
          }
        })
        .sort((a, b) => b.score - a.score)

      targetIndex = options[0]?.index ?? holderIndex
      passProgress = 0
      actionCooldown = 95
      const target = players[targetIndex]
      eventText = target.isSprinting ? 'THROUGH BALL RUN' : target.role === 'FW' ? 'THROUGH BALL' : 'CONTROLLED PASS'
    }

    const resetAfterShot = (goal: boolean) => {
      if (!shotInFlight) return
      shotInFlight = false
      const scoredByHome = players[holderIndex].home
      if (goal) {
        onScoreRef.current(scoredByHome ? 'home' : 'away')
        eventText = scoredByHome ? `GOAL FOR ${homeName.toUpperCase()}` : `GOAL FOR ${awayName.toUpperCase()}`
        lastGoalFrame = frame
      } else {
        eventText = 'SHOT SAVED'
      }

      possessionHome = !scoredByHome
      holderIndex = possessionHome ? 6 : 17
      targetIndex = holderIndex
      passProgress = 1
      completedPasses = 0
      actionCooldown = goal ? 210 : 135
      ball.x = canvas.clientWidth * 0.5
      ball.y = canvas.clientHeight * 0.5
      ball.vx = 0
      ball.vy = 0
    }

    const tryShot = () => {
      const holder = players[holderIndex]
      const strength = teamStrengthFor(holder.home, homeStrength, awayStrength)
      const opponentStrength = teamStrengthFor(!holder.home, homeStrength, awayStrength)
      const attackingRight = holder.home
      const finalThird = attackingRight ? holder.x > canvas.clientWidth * 0.68 : holder.x < canvas.clientWidth * 0.32
      const enoughBuildUp = completedPasses >= 4
      const shotCooldownReady = frame - lastShotFrame > 520
      const strikerBonus = holder.role === 'FW' ? 0.08 : holder.role === 'MF' ? 0.02 : -0.12
      const weightedChance = clamp(0.09 + (strength - opponentStrength) / 210 + strikerBonus, 0.04, 0.24)
      const shotRoll = seededNoise(frame + holderIndex * 101 + strength * 7)

      if (!finalThird || !enoughBuildUp || !shotCooldownReady || shotInFlight) return false

      ball.vx += ((attackingRight ? canvas.clientWidth - 30 : 30) - ball.x) * 0.16
      ball.vy += (canvas.clientHeight * 0.5 - ball.y) * 0.11
      eventText = 'SHOT ON GOAL'
      shotInFlight = true
      lastShotFrame = frame

      if (shotRoll < weightedChance) {
        window.setTimeout(() => resetAfterShot(true), 760)
      } else {
        window.setTimeout(() => resetAfterShot(false), 760)
      }

      return true
    }

    const tick = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const holder = players[holderIndex]
      const teamStrength = teamStrengthFor(holder.home, homeStrength, awayStrength)
      const opponentStrength = teamStrengthFor(!holder.home, homeStrength, awayStrength)
      const push = clamp((teamStrength - opponentStrength) / 80, -0.14, 0.14)

      frame += 1
      drawPitch(ctx, width, height)
      actionCooldown = Math.max(0, actionCooldown - 1)

      if (isRunning && passProgress >= 1 && actionCooldown === 0 && frame - lastGoalFrame > 170 && !shotInFlight) {
        if (!tryShot()) choosePass()
      }

      if (isRunning && passProgress < 1) {
        passProgress = Math.min(1, passProgress + 0.014)
        if (passProgress >= 1) {
          holderIndex = targetIndex
          completedPasses += 1
          actionCooldown = 85
          eventText = players[holderIndex].role === 'FW' ? 'ATTACKING THIRD' : 'POSSESSION'
        }
      }

      const targetHolder = players[targetIndex]

      players.forEach((player, index) => {
        const isTeamInPossession = player.home === holder.home
        const isHolder = index === holderIndex
        const isPassTarget = index === targetIndex && passProgress < 1
        const teamDir = player.home ? 1 : -1
        const side = player.home ? 1 : -1

        // ── Run trigger logic ─────────────────────────────────────────
        player.runTimer = Math.max(0, player.runTimer - 1)

        if (isRunning && !isHolder && isTeamInPossession && player.runTimer === 0) {
          const canRun = player.role === 'FW' || player.role === 'MF'
          const holderInMiddle = holder.x > width * 0.3 && holder.x < width * 0.7

          if (canRun && holderInMiddle) {
            // Diagonal run into space ahead of the ball
            const runDepth = player.role === 'FW'
              ? clamp(player.x + teamDir * width * (0.28 + seededNoise(frame + index) * 0.14), 40, width - 40)
              : clamp(player.x + teamDir * width * (0.12 + seededNoise(frame + index * 3) * 0.1), 40, width - 40)
            const runLane = clamp(
              player.y + (seededNoise(frame + index * 7) - 0.5) * height * 0.38,
              40,
              height - 40,
            )
            player.runTargetX = runDepth
            player.runTargetY = runLane
            player.isSprinting = true
            // Reset timer: FW runs again sooner, MF waits longer
            player.runTimer = player.role === 'FW' ? 80 + Math.floor(seededNoise(frame + index * 13) * 60) : 130 + Math.floor(seededNoise(frame + index * 11) * 80)
            if (player.role === 'FW') eventText = 'RUN IN BEHIND'
          }
        }

        // Cancel run if team loses possession or run reached
        if (!isTeamInPossession || (player.runTargetX !== null && Math.hypot(player.x - player.runTargetX, player.y - (player.runTargetY ?? player.y)) < 12)) {
          player.runTargetX = null
          player.runTargetY = null
          player.isSprinting = false
        }

        // After receiving a pass, burst forward briefly before the next decision
        if (isHolder && passProgress >= 1) {
          if (player.runTargetX === null) {
            player.runTargetX = clamp(player.x + teamDir * width * 0.06, 40, width - 40)
            player.runTargetY = player.y
            player.isSprinting = true
          }
        }

        // ── Desired position ──────────────────────────────────────────
        const phase = Math.sin(frame * 0.008 + index * 1.41)
        const baseShift = isTeamInPossession ? 0.08 + push : -0.03 + push * 0.45
        const roleSpread = player.role === 'FW' ? 0.05 : player.role === 'DF' ? -0.03 : 0.01
        const formationX = clamp((player.baseX + teamDir * (baseShift + roleSpread)) * width, 34, width - 34)
        const formationY = clamp(player.baseY * height + phase * 14, 34, height - 34)

        // Pass target sprints hard to meet the ball
        const receiverSprintX = isPassTarget
          ? clamp(targetHolder.x + teamDir * 18, 34, width - 34)
          : null

        let desiredX: number
        let desiredY: number
        let accel: number

        if (isHolder) {
          // Ball carrier dribbles forward with lateral wiggle
          desiredX = clamp(player.x + teamDir * (0.7 + teamStrength / 170), 34, width - 34)
          desiredY = clamp(player.y + Math.sin(frame * 0.06 + index) * 1.6, 34, height - 34)
          accel = 0.018
        } else if (receiverSprintX !== null) {
          // Player about to receive — sprint to intercept
          desiredX = receiverSprintX
          desiredY = targetHolder.y + (seededNoise(frame + index * 5) - 0.5) * 10
          accel = 0.045
        } else if (player.isSprinting && player.runTargetX !== null) {
          // Active run into space
          desiredX = player.runTargetX
          desiredY = player.runTargetY ?? formationY
          accel = 0.038
        } else {
          // Pressing: opponents without ball close down
          const distanceToBall = Math.hypot(player.x - ball.x, player.y - ball.y)
          const pressRange = Math.min(width, height) * (player.role === 'FW' ? 0.28 : 0.2)
          const shouldPress = !isTeamInPossession && distanceToBall < pressRange && player.role !== 'GK'

          if (shouldPress) {
            desiredX = ball.x - side * 10
            desiredY = ball.y + (seededNoise(frame + index * 9) - 0.5) * 20
            accel = 0.022
          } else {
            desiredX = formationX
            desiredY = formationY
            accel = 0.01
          }
        }

        // Separation: prevent players from stacking
        players.forEach((other, otherIndex) => {
          if (otherIndex === index) return
          const dx = player.x - other.x
          const dy = player.y - other.y
          const dist = Math.max(1, Math.hypot(dx, dy))
          const minGap = Math.min(width, height) * 0.052
          if (dist < minGap) {
            desiredX += (dx / dist) * (minGap - dist) * 0.7
            desiredY += (dy / dist) * (minGap - dist) * 0.7
          }
        })

        player.vx += (desiredX - player.x) * accel
        player.vy += (desiredY - player.y) * accel
        // Sprinting players have less drag (faster top speed)
        const drag = player.isSprinting || isPassTarget ? 0.78 : 0.72
        player.vx *= drag
        player.vy *= drag
        player.x = clamp(player.x + player.vx, 34, width - 34)
        player.y = clamp(player.y + player.vy, 34, height - 34)
      })

      const ballTarget = passProgress < 1 ? targetHolder : players[holderIndex]
      ball.vx += (ballTarget.x + (ballTarget.home ? 14 : -14) - ball.x) * (isRunning ? (passProgress < 1 ? 0.038 : 0.026) : 0.012)
      ball.vy += (ballTarget.y - ball.y) * (isRunning ? (passProgress < 1 ? 0.038 : 0.026) : 0.012)
      ball.vx *= 0.78
      ball.vy *= 0.78
      ball.x = clamp(ball.x + ball.vx, 24, width - 24)
      ball.y = clamp(ball.y + ball.vy, 24, height - 24)

      trail.unshift({ x: ball.x, y: ball.y })
      trail.splice(22)
      trail.forEach((point, index) => {
        ctx.beginPath()
        ctx.fillStyle = `rgba(255,255,255,${0.22 - index * 0.009})`
        ctx.arc(point.x, point.y, Math.max(1, 5 - index * 0.18), 0, Math.PI * 2)
        ctx.fill()
      })

      // Draw run arrows for sprinting off-ball players
      players.forEach((player) => {
        if (!player.isSprinting || player.runTargetX === null) return
        ctx.save()
        ctx.strokeStyle = player.home ? 'rgba(255,255,255,0.28)' : 'rgba(0,200,255,0.28)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(player.x, player.y)
        ctx.lineTo(player.runTargetX, player.runTargetY ?? player.y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      })

      players.forEach((player, index) =>
        drawAgent(
          ctx,
          circle,
          player,
          player.home ? '#f7f9ff' : '#0d5dff',
          player.home ? '#ffffff' : '#00c8ff',
          index === holderIndex,
        ),
      )

      ctx.save()
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = 18
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(ball.x, ball.y, 5.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      const clockLabel = isRunning ? `${String(matchMinute).padStart(2, '0')}:00` : 'PRE-MATCH'
      const eventLabel = isRunning ? eventText : 'MATCH READY'
      const hudText = `${clockLabel}  ${eventLabel}`
      ctx.font = '700 12px Orbitron, sans-serif'
      const textW = ctx.measureText(hudText).width
      const hudW = Math.min(width - 64, Math.max(180, textW + 32))
      const hudX = Math.round((width - hudW) / 2)
      const hudY = 14
      ctx.fillStyle = 'rgba(2,7,18,0.82)'
      ctx.fillRect(hudX, hudY, hudW, 34)
      ctx.strokeStyle = 'rgba(0,200,255,0.35)'
      ctx.lineWidth = 1
      ctx.strokeRect(hudX, hudY, hudW, 34)
      ctx.fillStyle = frame - lastGoalFrame < 90 ? '#ffffff' : '#dbeafe'
      ctx.textAlign = 'center'
      ctx.fillText(hudText, hudX + hudW / 2, hudY + 22, hudW - 16)
      ctx.textAlign = 'left'

      animation = requestAnimationFrame(tick)
    }

    circle.onload = tick

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animation)
    }
  }, [awayLineup, awayName, awayStrength, homeLineup, homeName, homeStrength, isRunning, matchMinute])

  return <canvas className="evo-canvas" ref={canvasRef} aria-label="Football Evolution AI match simulation" />
}
