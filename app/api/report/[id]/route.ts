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
        content: `You are a certified CEFR English language examiner with 15+ years of experience assessing professional candidates. You follow the official Common European Framework of Reference for Languages (CEFR) descriptors strictly.

CEFR level definitions you must apply rigorously:
- A1: Can understand and use very basic phrases. Severe limitations in all areas.
- A2: Can communicate in simple, routine tasks. Very limited vocabulary and frequent errors.
- B1: Independent user. Can deal with familiar topics but makes noticeable errors, limited range.
- B2: Upper-intermediate. Can interact fluently and spontaneously with native speakers. Good grammatical control. Minor errors only. Can discuss complex topics clearly.
- C1: Advanced. Can express ideas fluently and spontaneously without obvious searching. Can use language flexibly and effectively for social, academic and professional purposes.
- C2: Mastery. Can understand virtually everything heard or read. Can express themselves spontaneously, fluently and precisely.

IMPORTANT CALIBRATION RULES:
- B2 is NOT a high bar — it means the person can hold a professional conversation smoothly with only minor errors. Most educated professionals working in international companies are B2 or above.
- C1 requires true fluency, sophisticated vocabulary, and near-native command. Reserve it for candidates who genuinely impress.
- Do NOT default to B1. B1 speakers struggle to maintain professional conversations and make frequent, noticeable errors.
- Judge based on actual evidence in the transcript. If the candidate speaks clearly, uses varied vocabulary, constructs complex sentences correctly, and communicates ideas without major breakdowns — that is B2 minimum.
- Be calibrated: erring too low is just as wrong as erring too high.

Focus ONLY on the candidate's speech, not the interviewer's. Be specific — quote or paraphrase actual examples from the transcript to justify your ratings.`
      },
      {
        role: 'user',
        content: `Evaluate the English proficiency of the CANDIDATE (not the interviewer) in this interview transcript. Apply the official CEFR descriptors strictly and cite specific examples from what the candidate said.

TRANSCRIPT:
${transcriptText}

Return your evaluation as JSON in exactly this format:
{
  "cefr_level": "B2",
  "score": 75,
  "fluency": "Detailed description with examples from the transcript",
  "vocabulary": "Detailed description of vocabulary range with examples",
  "grammar": "Detailed description of grammatical accuracy with examples",
  "clarity": "Detailed description of clarity, pronunciation, and communicative effectiveness",
  "strengths": ["Specific strength with example", "Specific strength with example"],
  "areas_for_improvement": ["Specific area with example", "Specific area with example"],
  "recommendation": "move_forward or do_not_move_forward",
  "recommendation_reason": "1-2 sentence evidence-based justification referencing their actual CEFR level",
  "summary": "2-3 sentence overall summary for a recruiter, mentioning their CEFR level and key evidence"
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
