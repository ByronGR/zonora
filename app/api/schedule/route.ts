import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    candidate_name,
    candidate_email,
    meeting_link,
    scheduled_at,
    job_title,
    job_description,
    custom_questions,
  } = body

  const supabase = createServerClient()

  const { data: interview, error } = await supabase
    .from('interviews')
    .insert([{
      candidate_name,
      candidate_email,
      meeting_link,
      scheduled_at,
      job_title: job_title || null,
      job_description: job_description || null,
      custom_questions: custom_questions || [],
    }])
    .select()
    .single()

  if (error) {
    console.error('Supabase error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://zonora.vercel.app'}/api/webhook/recall`

  const recallRes = await fetch('https://us-west-2.recall.ai/api/v1/bot/', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.RECALL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meeting_url: meeting_link,
      bot_name: 'Zonora',
      join_at: new Date(scheduled_at).toISOString(),
      recording_config: {
        transcript: {
          provider: {
            gladia_v2_streaming: {
                endpointing: 2000,
              },
          },
          diarization: {
            use_separate_streams_when_available: true,
          },
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            url: webhookUrl,
            events: [
              'transcript.data',
              'participant_events.speech_on',
            ],
          },
        ],
      },
      automatic_leave: {
        waiting_room_timeout: 300,
        everyone_left_timeout: 30,
      },
    }),
  })

  const recallData = await recallRes.json()

  if (!recallRes.ok) {
    console.error('Recall.ai error:', recallData)
    return NextResponse.json({ error: 'Recall.ai error', details: recallData }, { status: 500 })
  }

  await supabase
    .from('interviews')
    .update({ recall_bot_id: recallData.id, bot_status: 'scheduled' })
    .eq('id', interview.id)

  return NextResponse.json({ success: true, interview, bot: recallData })
}
