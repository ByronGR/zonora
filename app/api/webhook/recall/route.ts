import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { generateAndSpeak } from '@/lib/speak'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Target ~30 min interview. GPT will wrap up naturally when it has enough info,
// MAX_BOT_TURNS is a hard ceiling so the call doesn't run forever.
const MAX_BOT_TURNS = 22

type Turn = { role: 'bot' | 'candidate'; content: string; timestamp: string }

async function leaveCall(botId: string) {
  await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/leave_call/`, {
    method: 'POST',
    headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}` },
  })
}

async function claimAndPlayIntro(botId: string, interview: Record<string, unknown>): Promise<boolean> {
  const supabase = createAdminClient()
  const name = (interview.candidate_name as string) || 'there'
  const role = interview.job_title ? ` for the ${interview.job_title as string} position` : ''

  const intro = `Hi ${name}! Welcome, and thank you so much for taking the time today. My name is Zonora and I'll be your interviewer${role}. Before we get started, I just want to let you know this is a relaxed conversation — there are no trick questions, and I genuinely want to hear your story. This should take around 30 minutes. Does that sound good to you, and are you ready to begin?`

  const history: Turn[] = [{ role: 'bot', content: intro, timestamp: new Date().toISOString() }]

  // Atomic claim — only one handler wins, prevents double intro
  const { data: updated } = await supabase
    .from('interviews')
    .update({ conversation_history: history, bot_status: 'in_call' })
    .eq('id', interview.id)
    .neq('bot_status', 'in_call')
    .select()
    .single()

  if (!updated) {
    console.log('[webhook] Intro already claimed, skipping')
    return false
  }

  await generateAndSpeak(botId, intro, interview.id as string)
  return true
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = createAdminClient()

  const event = body.event as string | undefined
  console.log('[webhook] event:', event)

  // ── participant_events.speech_on ───────────────────────────────────────────
  if (event === 'participant_events.speech_on') {
    const botId = body.data?.bot?.id
    const participant = body.data?.data?.participant

    if (!botId) return NextResponse.json({ received: true })
    if (participant?.name === 'Zonora') return NextResponse.json({ received: true })

    const { data: interview } = await supabase
      .from('interviews').select('*').eq('recall_bot_id', botId).single()

    if (!interview) return NextResponse.json({ received: true })

    if (interview.bot_status !== 'in_call') {
      console.log('[webhook] First speech — playing intro')
      await claimAndPlayIntro(botId, interview)
    }

    return NextResponse.json({ received: true })
  }

  // ── bot.in_call_recording ─────────────────────────────────────────────────
  if (event === 'bot.in_call_recording') {
    const botId = body.data?.bot?.id
    if (!botId) return NextResponse.json({ received: true })

    const { data: interview } = await supabase
      .from('interviews').select('*').eq('recall_bot_id', botId).single()

    if (!interview) return NextResponse.json({ received: true })

    if (interview.bot_status !== 'in_call') {
      console.log('[webhook] bot.in_call_recording — playing intro')
      await claimAndPlayIntro(botId, interview)
    }

    return NextResponse.json({ received: true })
  }

  // ── bot.done ──────────────────────────────────────────────────────────────
  if (event === 'bot.done') {
    const botId = body.data?.bot?.id
    if (botId) {
      await supabase.from('interviews').update({ bot_status: 'done' }).eq('recall_bot_id', botId)
    }
    return NextResponse.json({ received: true })
  }

  // ── transcript.data ───────────────────────────────────────────────────────
  if (event === 'transcript.data') {
    const botId = body.data?.bot?.id
    const words: { text: string }[] | undefined = body.data?.data?.words
    const participant = body.data?.data?.participant
    const isFinal: boolean = body.data?.data?.is_final ?? true

    if (!botId || !words || words.length === 0) return NextResponse.json({ received: true })
    if (participant?.name === 'Zonora') return NextResponse.json({ received: true })

    // Only process complete utterances — skip streaming partials
    if (!isFinal) return NextResponse.json({ received: true })

    const { data: interview } = await supabase
      .from('interviews').select('*').eq('recall_bot_id', botId).single()

    if (!interview) return NextResponse.json({ received: true })

    const candidateText = words.map((w: { text: string }) => w.text).join(' ').trim()
    if (!candidateText || candidateText.length < 3) return NextResponse.json({ received: true })

    // If bot is still speaking, save the message so we don't lose it
    if (interview.bot_speaking_until) {
      const until = new Date(interview.bot_speaking_until).getTime()
      if (Date.now() < until) {
        console.log('[webhook] Bot still speaking — saving pending transcript:', candidateText.slice(0, 60))
        await supabase.from('interviews').update({ pending_transcript: candidateText }).eq('id', interview.id)
        return NextResponse.json({ received: true })
      }
    }

    // Check if there's a saved transcript from when bot was speaking — use it if no new text
    let textToProcess = candidateText
    if (interview.pending_transcript && candidateText.toLowerCase() !== interview.pending_transcript.toLowerCase()) {
      // Combine pending + new, or just use whichever is more meaningful
      textToProcess = candidateText.length >= interview.pending_transcript.length
        ? candidateText
        : interview.pending_transcript
    }
    // Clear pending transcript
    await supabase.from('interviews').update({ pending_transcript: null }).eq('id', interview.id)

    console.log('[webhook] Candidate said:', textToProcess.slice(0, 120))

    if (interview.bot_status !== 'in_call') {
      await claimAndPlayIntro(botId, interview)
      return NextResponse.json({ received: true })
    }

    const history: Turn[] = interview.conversation_history || []

    // If candidate is asking to repeat the question, replay the last bot message
    const wantsRepeat = /repeat|say that again|didn't (hear|catch|understand)|pardon|what (did you|was that)|come again|can you say|once more/i.test(textToProcess)
    if (wantsRepeat) {
      const lastBotTurn = [...history].reverse().find(t => t.role === 'bot')
      if (lastBotTurn) {
        console.log('[webhook] Candidate asked to repeat — replaying last message')
        await generateAndSpeak(botId, lastBotTurn.content, interview.id)
        return NextResponse.json({ received: true })
      }
    }

    history.push({ role: 'candidate', content: textToProcess, timestamp: new Date().toISOString() })

    const botTurnCount = history.filter(t => t.role === 'bot').length
    const isHardLimit = botTurnCount >= MAX_BOT_TURNS

    let botResponse: string

    if (isHardLimit) {
      const name = (interview.candidate_name as string) || ''
      botResponse = `Thank you so much ${name}, this has been a wonderful conversation. Our team at Nearwork will review your assessment and be in touch soon. Wishing you a great rest of your day — take care!`
    } else {
      const systemPrompt = `You are Zonora, a warm and professional AI interviewer for Nearwork, a recruiting platform. You are conducting a real voice interview — the candidate can hear you speaking.

Position: ${interview.job_title || 'an open role'}
${interview.job_description ? `\nJob Description:\n${interview.job_description}` : ''}

YOUR STYLE:
- Warm, human, and encouraging — like a great hiring manager, not a robot.
- Ask one open-ended question per turn: "Tell me about...", "Walk me through...", "How did you handle...", "What did you learn from...".
- After the candidate answers, briefly acknowledge what they said before your next question. Keep it natural.
- Never use filler phrases: "certainly", "absolutely", "great question", "of course".
- No markdown. No lists. This is a spoken conversation.
- Speak in plain, clear sentences. Max 3 sentences per turn.

INTERVIEW FLOW (target ~30 min, 15–20 exchanges):
- Turns 1–3: Light icebreaker, background, what brings them here.
- Turns 4–10: Role-specific experience — projects, responsibilities, skills.
- Turns 11–16: Situational and behavioral questions relevant to the role.
- Turns 17+: Wrap up naturally once you have a clear picture of the candidate.

ENDING THE INTERVIEW:
- When you have enough to assess the candidate's fit and communication skills (usually after turn 14–16), wrap up warmly and professionally. Don't drag it out.
- End with something like: "I think I have a great picture of your background. Thank you so much for your time today — our team will be in touch soon."
- If you decide to end early, include the phrase [END_INTERVIEW] at the very end of your response (this will be hidden from the candidate).

ENGLISH PROFICIENCY:
- You are assessing whether the candidate can communicate effectively in a professional setting, NOT whether they speak like a native American English speaker.
- What matters: Can they make their point clearly? Can they understand and respond appropriately? Do they express themselves with confidence?
- Accent, minor grammar errors, and non-native phrasing are completely fine and should not be penalized.

Turn ${botTurnCount + 1} of max ${MAX_BOT_TURNS}.`

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
        max_tokens: 180,
      })

      botResponse = completion.choices[0].message.content?.trim() || 'Could you tell me more about that?'
    }

    // Check if GPT signaled to end the interview early
    const shouldEnd = isHardLimit || botResponse.includes('[END_INTERVIEW]')
    botResponse = botResponse.replace('[END_INTERVIEW]', '').trim()

    console.log('[webhook] Bot responding:', botResponse.slice(0, 100))

    history.push({ role: 'bot', content: botResponse, timestamp: new Date().toISOString() })
    await supabase.from('interviews').update({ conversation_history: history }).eq('id', interview.id)
    await generateAndSpeak(botId, botResponse, interview.id)

    if (shouldEnd) {
      const delay = Math.ceil((botResponse.split(' ').length / 2.5) * 1000) + 6000
      setTimeout(() => leaveCall(botId), delay)
    }

    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}
