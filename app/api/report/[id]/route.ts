import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import OpenAI from 'openai'
import { toFile } from 'openai'

export const maxDuration = 60

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
    return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
  }

  if (!interview.recall_bot_id) {
    return NextResponse.json({ error: 'No bot associated with this interview' }, { status: 400 })
  }

  const botId = interview.recall_bot_id

  // Step 1: Get bot details including video URL from Recall.ai
  const botRes = await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/`, {
    headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}` },
  })

  if (!botRes.ok) {
    const err = await botRes.json()
    return NextResponse.json({ error: 'Failed to fetch bot details', details: err }, { status: 500 })
  }

  const botData = await botRes.json()
  const videoUrl = botData?.video_url || botData?.recordings?.[0]?.media_shortcuts?.video_mixed?.data?.download_url

  if (!videoUrl) {
    return NextResponse.json({ error: 'No video recording found for this bot. The bot may not have recorded the call.' }, { status: 400 })
  }

  // Step 2: Download the video
  const videoRes = await fetch(videoUrl)
  if (!videoRes.ok) {
    return NextResponse.json({ error: 'Failed to download recording' }, { status: 500 })
  }

  const videoBuffer = await videoRes.arrayBuffer()
  const videoFile = await toFile(Buffer.from(videoBuffer), 'recording.mp4', { type: 'video/mp4' })

  // Step 3: Transcribe with Whisper
  const transcription = await openai.audio.transcriptions.create({
    file: videoFile,
    model: 'whisper-1',
    language: 'en',
  })

  const transcriptText = transcription.text

  if (!transcriptText.trim()) {
    return NextResponse.json({ error: 'Transcript is empty. No speech was detected in the recording.' }, { status: 400 })
  }

  // Step 4: Send to GPT-4o for English evaluation
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert English language evaluator specializing in CEFR assessment for professional hiring contexts. Analyze the candidate's speech from a job interview transcript and provide a structured evaluation. Focus only on the candidate's speech. Be objective, fair, and specific with examples from the transcript.`
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

  // Step 5: Save to Supabase
  await supabase
    .from('interviews')
    .update({ transcript: transcriptText, report, status: 'completed' })
    .eq('id', id)

  return NextResponse.json({ success: true, report })
}
