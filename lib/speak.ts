import { createAdminClient } from './supabase-server'

const VOICE_ID = '21m00Tcm4TlvDq8ikWAM' // ElevenLabs - Rachel (clear, professional)

export async function generateAndSpeak(
  botId: string,
  text: string,
  interviewId: string
): Promise<void> {
  const supabase = createAdminClient()

  // Mark bot as speaking immediately so transcription events are ignored
  const wordCount = text.split(' ').length
  const durationMs = Math.ceil((wordCount / 2.5) * 1000) + 5000 // words/sec + buffer
  const speakingUntil = new Date(Date.now() + durationMs).toISOString()
  await supabase.from('interviews').update({ bot_speaking_until: speakingUntil }).eq('id', interviewId)

  // Generate audio with ElevenLabs
  const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!ttsRes.ok) {
    const err = await ttsRes.text()
    console.error('ElevenLabs TTS failed:', err)
    return
  }

  const audioBuffer = await ttsRes.arrayBuffer()
  const fileName = `${interviewId}/${Date.now()}.mp3`

  // Upload to Supabase Storage (bucket: audio — must be public)
  const { error: uploadError } = await supabase.storage
    .from('audio')
    .upload(fileName, Buffer.from(audioBuffer), {
      contentType: 'audio/mpeg',
      upsert: true,
    })

  if (uploadError) {
    console.error('Storage upload failed:', uploadError)
    return
  }

  const { data: { publicUrl } } = supabase.storage.from('audio').getPublicUrl(fileName)

  // Send audio to Recall.ai bot to play in the meeting
  const recallRes = await fetch(
    `https://us-west-2.recall.ai/api/v1/bot/${botId}/output_media/`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.RECALL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind: 'audio', audio_url: publicUrl }),
    }
  )

  if (!recallRes.ok) {
    const err = await recallRes.json()
    console.error('Recall output_media failed:', err)
  }
}
