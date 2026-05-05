import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
    console.error('Interview lookup error:', error)
    return NextResponse.json({ error: 'Interview not found', id, dbError: error?.message }, { status: 404 })
  }

  if (!interview.recall_bot_id) {
    return NextResponse.json({ error: 'No bot associated with this interview' }, { status: 400 })
  }

  // Fetch transcript from Recall.ai
  const recallRes = await fetch(`https://us-west-2.recall.ai/api/v2/bot/${interview.recall_bot_id}/transcript/`, {
    headers: {
      'Authorization': `Token ${process.env.RECALL_API_KEY}`,
    },
  })

  if (!recallRes.ok) {
    const err = await recallRes.json()
    return NextResponse.json({ error: 'Failed to fetch transcript', details: err }, { status: 500 })
  }

  const transcriptData = await recallRes.json()

  if (!Array.isArray(transcriptData) || transcriptData.length === 0) {
    return NextResponse.json({ error: 'Transcript is empty. Make sure transcription is enabled in Recall.ai and that speech occurred during the call.' }, { status: 400 })
  }

  // Format transcript into readable text
  const transcriptText = transcriptData
    .map((entry: { speaker: string; words: { text: string }[] }) =>
      `${entry.speaker}: ${entry.words.map((w: { text: string }) => w.text).join(' ')}`
    )
    .join('\n')

  if (!transcriptText.trim()) {
    return NextResponse.json({ error: 'Transcript is empty. Make sure transcription is enabled in Recall.ai and that speech occurred during the call.' }, { status: 400 })
  }

  // Send to OpenAI for English evaluation
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

  // Save transcript and report to Supabase
  await supabase
    .from('interviews')
    .update({ transcript: transcriptText, report, status: 'completed' })
    .eq('id', id)

  return NextResponse.json({ success: true, report })
}
