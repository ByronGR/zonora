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

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = createServerClient()

  const event = body.event as string | undefined

  // ── Bot status event (from Recall dashboard webhook) ───────────────────────
  if (event?.startsWith('bot.')) {
    const botId = body.data?.bot?.id
    if (!botId) return NextResponse.json({ received: true })

    const { data: interview } = await supabase
      .from('interviews')
      .select('*')
      .eq('recall_bot_id', botId)
      .single()

    if (!interview) return NextResponse.json({ received: true })

    const code = body.data?.status?.code

    if (code === 'in_call_recording') {
      await supabase.from('interviews').update({ bot_status: 'in_call' }).eq('id', interview.id)

      const name = interview.candidate_name || 'there'
      const role = interview.job_title ? ` for the ${interview.job_title} position` : ''
      const intro = `Hello ${name}, I'm Zonora, an AI interviewer. I'll be conducting a short assessment today${role}. This will take about 5 to 10 minutes. To start, could you tell me a little about yourself and your professional background?`

      const history: Turn[] = [{ role: 'bot', content: intro, timestamp: new Date().toISOString() }]
      await supabase.from('interviews').update({ conversation_history: history }).eq('id', interview.id)
      await generateAndSpeak(botId, intro, interview.id)
    }

    if (code === 'done') {
      await supabase.from('interviews').update({ bot_status: 'done' }).eq('id', interview.id)
    }

    return NextResponse.json({ received: true })
  }

  // ── Real-time transcript event ─────────────────────────────────────────────
  // New payload format: { event: "transcript.data", data: { data: { words, participant }, bot: { id } } }
  if (event === 'transcript.data') {
    const botId = body.data?.bot?.id
    const words: { text: string }[] | undefined = body.data?.data?.words
    const participant = body.data?.data?.participant

    if (!botId || !words || words.length === 0) return NextResponse.json({ received: true })

    // Filter out the bot's own voice being picked up
    if (participant?.name === 'Zonora') return NextResponse.json({ received: true })

    const { data: interview } = await supabase
      .from('interviews')
      .select('*')
      .eq('recall_bot_id', botId)
      .single()

    if (!interview) return NextResponse.json({ received: true })

    // Ignore if bot is currently speaking (prevent echo loops)
    if (interview.bot_speaking_until) {
      const until = new Date(interview.bot_speaking_until).getTime()
      if (Date.now() < until) return NextResponse.json({ received: true })
    }

    const candidateText = words.map(w => w.text).join(' ').trim()
    if (!candidateText || candidateText.length < 3) return NextResponse.json({ received: true })

    const history: Turn[] = interview.conversation_history || []
    history.push({ role: 'candidate', content: candidateText, timestamp: new Date().toISOString() })

    const botTurnCount = history.filter(t => t.role === 'bot').length
    const isLastTurn = botTurnCount >= MAX_BOT_TURNS

    let botResponse: string

    if (isLastTurn) {
      const name = interview.candidate_name || ''
      botResponse = `Thank you so much ${name}, it was great speaking with you today. Our recruiting team will review your assessment and be in touch soon with next steps. Have a wonderful day, goodbye!`
    } else {
      const systemPrompt = `You are Zonora, a professional AI interviewer working for Nearwork, a recruiting platform. You are conducting a voice interview.

Position: ${interview.job_title || 'an open role'}
${interview.job_description ? `Job Description:\n${interview.job_description}` : ''}

INTERVIEW FLOW:
- Turn 1: Already greeted and asked for intro (done).
- Turns 2–4: Ask targeted questions about their experience relevant to this specific role. Dig into specifics.
- Turn 5: Ask one final or wrap-up question about why they're interested in this role.
- Turn ${MAX_BOT_TURNS}: Always wrap up warmly and say goodbye.

CRITICAL RULES:
- Maximum 2 sentences per response. This is a VOICE call — be concise.
- No markdown, bullet points, or formatting of any kind.
- Do NOT say "certainly", "absolutely", "of course", "great question", or "interesting".
- Ask one clear question per turn.
- You are on bot turn ${botTurnCount + 1} of ${MAX_BOT_TURNS}.`

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

    history.push({ role: 'bot', content: botResponse, timestamp: new Date().toISOString() })

    await supabase
      .from('interviews')
      .update({ conversation_history: history })
      .eq('id', interview.id)

    await generateAndSpeak(botId, botResponse, interview.id)

    if (isLastTurn) {
      const delay = Math.ceil((botResponse.split(' ').length / 2.5) * 1000) + 6000
      setTimeout(() => leaveCall(botId), delay)
    }

    return NextResponse.json({ received: true })
  }

  // Unknown event — acknowledge and ignore
  return NextResponse.json({ received: true })
}
