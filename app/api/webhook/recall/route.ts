import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
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

async function playIntro(botId: string, interview: Record<string, unknown>) {
  const name = (interview.candidate_name as string) || 'there'
  const role = interview.job_title ? ` for the ${interview.job_title as string} position` : ''
  const intro = `Hello ${name}, I'm Zonora, an AI interviewer. I'll be conducting a short assessment today${role}. This will take about 5 to 10 minutes. To start, could you tell me a little about yourself and your professional background?`

  const history: Turn[] = [{ role: 'bot', content: intro, timestamp: new Date().toISOString() }]
  const supabase = createServerClient()
  await supabase.from('interviews').update({ conversation_history: history, bot_status: 'in_call' }).eq('id', interview.id)
  await generateAndSpeak(botId, intro, interview.id as string)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = createServerClient()

  const event = body.event as string | undefined
  console.log('[webhook] event:', event, '| keys:', Object.keys(body))

  // ── participant_events.speech_on — candidate starts speaking ───────────────
  // Used as intro trigger: first time we detect any participant speaking,
  // Zonora plays its greeting before the transcript even arrives.
  if (event === 'participant_events.speech_on') {
    const botId = body.data?.bot?.id
    const participant = body.data?.data?.participant

    if (!botId) return NextResponse.json({ received: true })

    // Ignore the bot's own audio being picked up
    if (participant?.name === 'Zonora') return NextResponse.json({ received: true })

    const { data: interview } = await supabase
      .from('interviews')
      .select('*')
      .eq('recall_bot_id', botId)
      .single()

    if (!interview) return NextResponse.json({ received: true })

    // Only play intro once — if conversation_history is empty
    const history: Turn[] = interview.conversation_history || []
    const botHasSpoken = history.some(t => t.role === 'bot')
    if (!botHasSpoken) {
      console.log('[webhook] First speech detected — playing intro')
      await playIntro(botId, interview)
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

    const history: Turn[] = interview.conversation_history || []
    const botHasSpoken = history.some(t => t.role === 'bot')
    if (!botHasSpoken) {
      console.log('[webhook] bot.in_call_recording — playing intro')
      await playIntro(botId, interview)
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

    if (!botId || !words || words.length === 0) return NextResponse.json({ received: true })

    // Filter out bot's own transcribed audio
    if (participant?.name === 'Zonora') return NextResponse.json({ received: true })

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

    const candidateText = words.map(w => w.text).join(' ').trim()
    if (!candidateText || candidateText.length < 3) return NextResponse.json({ received: true })

    console.log('[webhook] Candidate said:', candidateText.slice(0, 100))

    const history: Turn[] = interview.conversation_history || []

    // If intro hasn't been played yet, play it first then bail —
    // the candidate's words will be handled on the next transcript event
    const botHasSpoken = history.some(t => t.role === 'bot')
    if (!botHasSpoken) {
      console.log('[webhook] No intro yet — playing intro before responding')
      await playIntro(botId, interview)
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

  // Unknown event — log and ignore
  console.log('[webhook] Unhandled event:', event, JSON.stringify(body).slice(0, 200))
  return NextResponse.json({ received: true })
}
