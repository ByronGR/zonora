import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const supabase = createServerClient()

  // Get the interview
  const { data: interview, error } = await supabase
    .from('interviews')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !interview) {
    return NextResponse.json({ error: 'Interview not found', id, dbError: error?.message }, { status: 404 })
  }

  if (!interview.recall_bot_id) {
    return NextResponse.json({ error: 'No bot associated with this interview' }, { status: 400 })
  }

  const botId = interview.recall_bot_id

  // Step 1: Trigger async transcription
  const transcribeRes = await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/async_transcribe/`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.RECALL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ provider: { name: 'gladia' } }),
  })

  if (!transcribeRes.ok) {
    const err = await transcribeRes.json()
    console.error('Async transcription error:', err)
    // Continue anyway — transcript might already exist
  }

  // Step 2: Wait for transcription to process
  await wait(8000)

  // Step 3: Fetch transcript
  const transcriptRes = await fetch(`https://us-west-2.recall.ai/api/v2/bot/${botId}/transcript/`, {
    headers: {
      'Authorization': `Token ${process.env.RECALL_API_KEY}`,
    },
  })

  if (!transcriptRes.ok) {
    const err = await transcriptRes.json()
    return NextResponse.json({ error: 'Failed to fetch transcript', details: err }, { status: 500 })
  }

  const transcriptData = await transcriptRes.json()

  if (!Array.isArray(transcriptData) || transcriptData.length === 0) {
    return NextResponse.json({ error: 'Transcript is empty. The transcription may still be processing — please try again in a minute.' }, { status: 400 })
  }

  // Step 4: Format transcript
  const transcriptText = transcriptData
    .map((entry: { speaker: string; words: { text: string }[] }) =>
      `${entry.speaker}: ${entry.words.map((w: { text: string }) => w.text).join(' ')}`
    )
    .join('\n')

  // Step 5: Send to OpenAI for English evaluation
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert English language evaluator specializing in CEFR assessment for professional hiring contexts. Analyze the candidate's speech from a job interview transcript and provide a structured evaluation. Focus only on the candidate's speech, not the interviewer. Be objective, fair, and specific with examples from the transcript.`
      },
      {
        role: 'user',
        content: `Please evaluate the English proficiency of the candidate in this interview transcript:

${transcriptText}

Provide your evaluation in the following JSON format:
{
  "cefr_level": "B2",
  "score": 75,
  "fluency": "Description of fluency",
  "vocabulary": "Description of vocabulary range",
  "grammar": "Description of grammatical accuracy",
  "clarity": "Description of clarity and pronunciation",
  "strengths": ["strength 1", "strength 2"],
  "areas_for_improvement": ["area 1", "area 2"],
  "recommendation": "move_forward or do_not_move_forward",
  "recommendation_reason": "Brief explanation of the recommendation",
  "summary": "A 2-3 sentence overall summary for the recruiter"
}`
      }
    ],
    response_format: { type: 'json_object' }
  })

  const report = JSON.parse(completion.choices[0].message.content || '{}')

  // Step 6: Save everything to Supabase
  await supabase
    .from('interviews')
    .update({ transcript: transcriptText, report, status: 'completed' })
    .eq('id', id)

  return NextResponse.json({ success: true, report })
}
