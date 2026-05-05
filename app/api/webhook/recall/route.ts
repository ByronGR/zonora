import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { generateAndSpeak } from '@/lib/speak'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const MAX_BOT_TURNS = 6

type Turn = { role: 'bot' | 'candidate'; content: string; timestamp: string }

async function leaveCall(botId: string) {
  await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/leave_call/`, {
    method: 'POST',
    headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}` },
  })
}

// Returns true if this handler "won" the intro lock, false if another handler already played it
async function claimAndPlayIntro(botId: string, interview: Record<string, unknown>): Promise<boolean> {
  const supabase = createAdminClient()
  const name = (interview.candidate_name as string) || 'there'
  const role = interview.job_title ? ` for the ${interview.job_title as string} position` : ''
  const intro = `Hello ${name}, I'm Zonora, an AI interviewer. I'll be conducting a short assessment today${role}. This will take about 5 to 10 minutes. To start, could you tell me a little about yourself and your professional background?`

  const history: Turn[] = [{ role: 'bot', content: intro, timestamp: new Date().toISOString() }]

  // Atomic update: only succeeds if bot_status is still 'scheduled' or null — prevents double intro
  const { data: updated } = await supabase
    .from('interviews')
    .update({ conversation_history: history, bot_status: 'in_call' })
    .eq('id', interview.id)
    .neq('bot_status', 'in_call')
    .select()
    .single()

  if (!updated) {
    console.log('[webhook] Intro already claimed by another handler, skipping')
    return false
  }

  await generateAndSpeak(botId, intro, interview.id as string)
  return true
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = createAdminClient()

  const event = body.event as string | undefined
  console.log('[webhook] event:', event, '| keys:', Object.keys(body))

  // ── participant_events.speech_on — candidate starts speaking ───────────────
  if (event === 'participant_events.speech_on') {
    const botId = body.data?.bot?.id
    const participant = body.data?.data?.participant

    if (!botId) return NextResponse.json({ received: true })
    if (participant?.name === 'Zonora') return NextResponse.json({ received: true })

    const { data: interview } = await supabase
      .from('interviews')
      .select('*')
      .eq('recall_bot_id', botId)
      .single()

    if (!interview) return NextResponse.json({ received: true })

    if (interview.bot_status !== 'in_call') {
      console.log('[webhook] First speech detected — playing intro')
      await claimAndPlayIntro(botId, interview)
    }

    return NextResponse.json({ received: true })
  }

  // ── bot.in_call_recording — bot joined and is recording ───────────────────
  if (event === 'bot.in_call_recording') {
    const botId = body.data?.bot?.id
    if (!botId) return NextResponse.json({ received: true })

    const { data: interview } = await supabase
      .from('interviews')
      .select('*')
      .eq('recall_bot_id', botId)
      .single()

    if (!interview) return NextResponse.json({ received: true })

    if (interview.bot_status !== 'in_call') {
      console.log('[webhook] bot.in_call_recording — playing intro')
      await claimAndPlayIntro(botId, interview)
    }

    return NextResponse.json({ received: true })
  }

  // ── bot.done — bot has left ────────────────────────────────────────────────
  if (event === 'bot.done') {
    const botId = body.data?.bot?.id
    if (botId) {
      await supabase.from('interviews').update({ bot_status: 'done' }).eq('recall_bot_id', botId)
    }
    return NextResponse.json({ received: true })
  }

  // ── transcript.data — candidate finished an utterance ─────────────────────
  if (event === 'transcript.data') {
    const botId = body.data?.bot?.id
    const words: { text: string }[] | undefined = body.data?.data?.words
    const participant = body.data?.data?.participant
    const isFinal: boolean = body.data?.data?.is_final ?? true

    if (!botId || !words || words.length === 0) return NextResponse.json({ received: true })
    if (participant?.name === 'Zonora') return NextResponse.json({ received: true })

    // Only process complete utterances, not streaming partials
    if (!isFinal) return NextResponse.json({ received: true })

    const { data: interview } = await supabase
      .from('interviews')
      .select('*')
      .eq('recall_bot_id', botId)
      .single()

    if (!interview) return NextResponse.json({ received: true })

    // Ignore if bot is currently speaking
    if (interview.bot_speaking_until) {
      const until = new Date(interview.bot_speaking_until).getTime()
      if (Date.now() < until) {
        console.log('[webhook] Bot still speaking, ignoring transcript')
        return NextResponse.json({ received: true })
      }
    }

    const candidateText = words.map((w: { text: string }) => w.text).join(' ').trim()
    if (!candidateText || candidateText.length < 3) return NextResponse.json({ received: true })

    console.log('[webhook] Candidate said:', candidateText.slice(0, 100))

    const history: Turn[] = interview.conversation_history || []

    // If intro hasn't been played yet, play it first
    if (interview.bot_status !== 'in_call') {
      console.log('[webhook] No intro yet — playing intro before responding')
      await claimAndPlayIntro(botId, interview)
      return NextResponse.json({ received: true })
    }

    history.push({ role: 'candidate', content: candidateText, timestamp: new Date().toISOString() })

    const botTurnCount = history.filter(t => t.role === 'bot').length
    const isLastTurn = botTurnCount >= MAX_BOT_TURNS

    let botResponse: string

    if (isLastTurn) {
      const name = (interview.candidate_name as string) || ''
      botResponse = `Thank you so much ${name}, it was great speaking with you today. Our recruiting team will review your assessment and be in touch soon. Have a wonderful day, goodbye!`
    } else {
      const systemPrompt = `You are Zonora, a professional AI interviewer for Nearwork, a recruiting platform. Voice interview in progress.

Position: ${interview.job_title || 'an open role'}
${interview.job_description ? `Job Description:\n${interview.job_description}` : ''}

RULES:
- Max 2 sentences. This is a VOICE call.
- No markdown or formatting.
- No filler words like "certainly", "absolutely", "great question".
- Ask one focused question per turn.
- Wait for the candidate to fully finish before responding.
- Turn ${botTurnCount + 1} of ${MAX_BOT_TURNS}. On turn ${MAX_BOT_TURNS}, wrap up and say goodbye.`

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...history.map(t => ({
          role: (t.role === 'bot' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: t.content,
        })),
      ]

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        max_tokens: 120,
      })

      botResponse = completion.choices[0].message.content?.trim() || 'Could you tell me more about that?'
    }

    console.log('[webhook] Bot responding:', botResponse.slice(0, 80))

    history.push({ role: 'bot', content: botResponse, timestamp: new Date().toISOString() })
    await supabase.from('interviews').update({ conversation_history: history }).eq('id', interview.id)
    await generateAndSpeak(botId, botResponse, interview.id)

    if (isLastTurn) {
      const delay = Math.ceil((botResponse.split(' ').length / 2.5) * 1000) + 6000
      setTimeout(() => leaveCall(botId), delay)
    }

    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}
