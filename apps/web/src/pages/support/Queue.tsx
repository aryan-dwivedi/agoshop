import AgoraRTC, {
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type IMicrophoneAudioTrack,
  type IRemoteAudioTrack,
} from 'agora-rtc-sdk-ng';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../lib/api';
import { useSession } from '../../state/session';

type SupportTicket = {
  id: string;
  conversationId: string;
  userId: string;
  status: 'queued' | 'assigned' | 'active' | 'closed' | 'cancelled';
  reason: string;
  orderId: string | null;
  preference: string | null;
  assignedAgentId: string | null;
  supportRtcUid: number | null;
  transcript: { role: string; text: string; at: string }[];
  createdAt: string;
  acceptedAt: string | null;
};

type ActiveCall = {
  ticketId: string;
  channel: string;
  client: IAgoraRTCClient;
  mic: IMicrophoneAudioTrack | null;
};

type CallPhase =
  | 'idle'
  | 'claiming'
  | 'microphone'
  | 'joining'
  | 'connected'
  | 'reconnecting'
  | 'ending'
  | 'failed';

const PHASE_COPY: Record<Exclude<CallPhase, 'idle'>, { title: string; detail: string }> = {
  claiming: {
    title: 'Accepting the ticket',
    detail: 'Reserving this shopper for you. No other agent can join this call.',
  },
  microphone: {
    title: 'Enable your microphone',
    detail: 'Allow microphone access in the browser prompt so the shopper can hear you.',
  },
  joining: {
    title: 'Joining the private call',
    detail: 'Your microphone is ready. Establishing the secure audio connection now.',
  },
  connected: {
    title: 'You are live with the shopper',
    detail: 'Speak normally. Keep this tab open until you end the call.',
  },
  reconnecting: {
    title: 'Reconnecting audio',
    detail: 'The network changed. Keep this tab open while Agora restores the call.',
  },
  ending: {
    title: 'Ending the call',
    detail: 'Closing the voice channel and notifying the shopper.',
  },
  failed: {
    title: 'The call did not connect',
    detail: 'The ticket is still assigned to you. Fix the issue below, then retry.',
  },
};

const connectionError = (error: unknown): string => {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access was blocked. Allow microphone access for this site, then retry.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No microphone was found. Connect a microphone, then retry.';
  }
  if (error instanceof Error && /UID_CONFLICT/i.test(error.message)) {
    return 'This call is already open in another tab. Close that tab, then retry here.';
  }
  return 'Audio could not connect. Check your microphone and network, then retry.';
};

const Queue = (): JSX.Element => {
  const { config, user } = useSession();
  const queryClient = useQueryClient();
  const callRef = useRef<ActiveCall | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [callPhase, setCallPhase] = useState<CallPhase>('idle');
  const [callError, setCallError] = useState<string | null>(null);
  const [localAudioLive, setLocalAudioLive] = useState(false);
  const [remoteAudio, setRemoteAudio] = useState<IRemoteAudioTrack | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['support-queue'],
    queryFn: () => api.get<{ tickets: SupportTicket[] }>('/api/support/queue'),
    refetchInterval: 5_000,
  });

  const teardownCall = useCallback(async (updateUi = true) => {
    const call = callRef.current;
    callRef.current = null;
    if (call) {
      call.client.removeAllListeners();
      if (call.mic) {
        try {
          await call.client.unpublish([call.mic]);
        } catch {
          // The connection may already be gone.
        }
      }
      await call.client.leave().catch(() => undefined);
      call.mic?.stop();
      call.mic?.close();
    }
    if (updateUi) {
      setRemoteAudio(null);
      setLocalAudioLive(false);
      setSelectedTicketId(null);
      setCallError(null);
      setCallPhase('idle');
    }
  }, []);

  useEffect(
    () => () => {
      void teardownCall(false);
    },
    [teardownCall],
  );

  const accept = async (ticketId: string): Promise<void> => {
    if (!config?.agoraAppId) {
      setSelectedTicketId(ticketId);
      setCallPhase('failed');
      setCallError(
        'Voice calling is not configured. Ask an administrator to check the Agora App ID.',
      );
      return;
    }

    await teardownCall();
    setSelectedTicketId(ticketId);
    setCallError(null);
    setCallPhase('claiming');

    try {
      const result = await api.post<{
        ticket: SupportTicket;
        rtcToken: string;
        channel: string;
        supportUid: number;
      }>(`/api/support/tickets/${ticketId}/accept`);

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      const call: ActiveCall = {
        ticketId,
        channel: result.channel,
        client,
        mic: null,
      };
      callRef.current = call;

      client.on('user-published', (remote: IAgoraRTCRemoteUser, mediaType) => {
        if (mediaType !== 'audio') return;
        void (async () => {
          try {
            await client.subscribe(remote, 'audio');
            const track = remote.audioTrack;
            if (!track) return;
            track.play();
            setRemoteAudio(track);
          } catch {
            setRemoteAudio(null);
            setCallError(
              'The shopper joined, but their audio could not play. Use “Resume shopper audio” or reconnect.',
            );
          }
        })();
      });
      client.on('user-unpublished', (_remote, mediaType) => {
        if (mediaType === 'audio') setRemoteAudio(null);
      });
      client.on('user-left', () => setRemoteAudio(null));
      client.on('connection-state-change', (current) => {
        if (callRef.current?.client !== client) return;
        if (current === 'RECONNECTING') setCallPhase('reconnecting');
        if (current === 'DISCONNECTED') {
          setCallPhase('failed');
          setCallError('The RTC connection ended. Check your network, then reconnect.');
        }
      });

      // Request the device before joining. A denied permission must not leave an
      // invisible RTC client occupying the support UID.
      setCallPhase('microphone');
      const mic = await AgoraRTC.createMicrophoneAudioTrack();
      call.mic = mic;

      setCallPhase('joining');
      await client.join(config.agoraAppId, result.channel, result.rtcToken, result.supportUid);
      await client.publish([mic]);
      setLocalAudioLive(true);

      // Only now is "active" truthful: the agent is in the channel and publishing.
      await api.post(`/api/support/tickets/${ticketId}/connected`);
      setCallPhase('connected');
      void queryClient.invalidateQueries({ queryKey: ['support-queue'] });
    } catch (error) {
      await teardownCall(false);
      setRemoteAudio(null);
      setLocalAudioLive(false);
      setSelectedTicketId(ticketId);
      setCallPhase('failed');
      setCallError(connectionError(error));
      void queryClient.invalidateQueries({ queryKey: ['support-queue'] });
    }
  };

  const close = async (ticketId: string): Promise<void> => {
    setCallError(null);
    if (selectedTicketId === ticketId) setCallPhase('ending');
    try {
      await api.post(`/api/support/tickets/${ticketId}/close`);
      if (selectedTicketId === ticketId) await teardownCall();
      void queryClient.invalidateQueries({ queryKey: ['support-queue'] });
    } catch {
      setSelectedTicketId(ticketId);
      setCallPhase('failed');
      setCallError('The ticket could not be closed. Check your connection and try again.');
    }
  };

  const resumeRemoteAudio = (): void => {
    if (!remoteAudio) return;
    AgoraRTC.resumeAudioContext();
    remoteAudio.play();
    setCallError(null);
  };

  const tickets = data?.tickets ?? [];
  const queuedCount = tickets.filter((ticket) => ticket.status === 'queued').length;
  const inProgressCount = tickets.filter((ticket) => ticket.status !== 'queued').length;
  const busy = !['idle', 'connected', 'failed'].includes(callPhase);
  const callCopy = callPhase === 'idle' ? null : PHASE_COPY[callPhase];

  return (
    <main className="mx-auto max-w-5xl space-y-5">
      <section className="overflow-hidden rounded-panel bg-gradient-to-br from-[#001e60] via-[#003b73] to-[#0071dc] p-5 text-white shadow-card">
        <p className="text-11 font-bold uppercase tracking-[0.18em] text-white/70">
          Live care desk
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-28 font-bold">Human support queue</h2>
            <p className="mt-1 max-w-2xl text-14 text-white/80">
              Review the context, accept one shopper, and follow the connection checks before
              speaking.
            </p>
          </div>
          <div className="flex gap-2 text-12 font-semibold">
            <span className="rounded-full bg-white/15 px-3 py-1.5">{queuedCount} waiting</span>
            <span className="rounded-full bg-white/15 px-3 py-1.5">
              {inProgressCount} in progress
            </span>
          </div>
        </div>
      </section>

      {callCopy && selectedTicketId ? (
        <section
          aria-live="polite"
          className={`card overflow-hidden border-l-4 p-0 ${
            callPhase === 'failed' ? 'border-l-danger' : 'border-l-accent'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <p className="text-11 font-bold uppercase tracking-[0.14em] text-accent">
                Ticket {selectedTicketId.slice(0, 8)}
              </p>
              <h3 className="mt-1 text-19 font-semibold text-t1">{callCopy.title}</h3>
              <p className="mt-1 max-w-2xl text-13 text-t2">{callCopy.detail}</p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-12 font-semibold ${
                callPhase === 'failed'
                  ? 'bg-live-wash text-danger'
                  : callPhase === 'connected'
                    ? 'bg-success-wash text-success'
                    : 'bg-accent-wash text-accent'
              }`}
            >
              {callPhase === 'connected'
                ? 'Call live'
                : callPhase === 'failed'
                  ? 'Action needed'
                  : 'Connecting'}
            </span>
          </div>

          <div className="grid gap-3 p-5 sm:grid-cols-3">
            <div className="rounded-ctl bg-surface p-3">
              <p className="text-11 font-bold uppercase tracking-wide text-t3">Microphone</p>
              <p
                className={`mt-1 text-13 font-semibold ${localAudioLive ? 'text-success' : 'text-t2'}`}
              >
                {localAudioLive ? 'Live — shopper can hear you' : 'Not live yet'}
              </p>
            </div>
            <div className="rounded-ctl bg-surface p-3">
              <p className="text-11 font-bold uppercase tracking-wide text-t3">Shopper audio</p>
              <p
                className={`mt-1 text-13 font-semibold ${remoteAudio ? 'text-success' : 'text-t2'}`}
              >
                {remoteAudio ? 'Connected — you can hear them' : 'Waiting for shopper audio'}
              </p>
            </div>
            <div className="rounded-ctl bg-surface p-3">
              <p className="text-11 font-bold uppercase tracking-wide text-t3">Private channel</p>
              <p className="mt-1 truncate text-13 font-semibold text-t2">
                {callRef.current?.channel ?? 'Preparing…'}
              </p>
            </div>
          </div>

          {callError ? (
            <p role="alert" className="mx-5 rounded-ctl bg-live-wash px-3 py-2 text-13 text-danger">
              {callError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 p-5 pt-4">
            {callPhase === 'failed' ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void accept(selectedTicketId)}
              >
                Retry connection
              </button>
            ) : null}
            {remoteAudio ? (
              <button type="button" className="btn-standard" onClick={resumeRemoteAudio}>
                Resume shopper audio
              </button>
            ) : null}
            <button
              type="button"
              className="btn-standard"
              disabled={callPhase === 'ending'}
              onClick={() => void close(selectedTicketId)}
            >
              {callPhase === 'ending' ? 'Ending…' : 'End call'}
            </button>
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-19 font-semibold text-t1">Tickets</h3>
            <p className="mt-0.5 text-13 text-t2">
              Oldest requests appear first. Assigned tickets stay available for reconnection.
            </p>
          </div>
        </div>

        {isLoading ? (
          <p className="card p-5 text-13 text-t2">Loading the support queue…</p>
        ) : tickets.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-16 font-semibold text-t1">All caught up</p>
            <p className="mt-1 text-13 text-t2">New human-support requests will appear here.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {tickets.map((ticket) => {
              const ownedByMe = ticket.assignedAgentId === user?.id;
              const canJoin = ticket.status === 'queued' || ownedByMe;
              const isSelected = ticket.id === selectedTicketId;
              return (
                <li
                  key={ticket.id}
                  className={`card p-4 transition ${
                    isSelected ? 'ring-2 ring-accent/30' : 'hover:border-accent/40'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-11 font-bold uppercase tracking-wide ${
                            ticket.status === 'queued'
                              ? 'bg-accent-wash text-accent'
                              : ticket.status === 'active'
                                ? 'bg-success-wash text-success'
                                : 'bg-accent-wash text-accent'
                          }`}
                        >
                          {ticket.status === 'queued'
                            ? 'Waiting'
                            : ownedByMe
                              ? `${ticket.status} to you`
                              : 'With another agent'}
                        </span>
                        <span className="text-12 text-t3">
                          {new Date(ticket.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-3 text-15 font-semibold text-t1">{ticket.reason}</p>
                      <p className="mt-1 text-12 text-t3">
                        {ticket.preference === 'callback' ? 'Phone callback' : 'In-app voice'}
                        {ticket.orderId ? ` · Order ${ticket.orderId.slice(0, 8)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canJoin && !isSelected ? (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busy}
                          onClick={() => void accept(ticket.id)}
                        >
                          {ticket.status === 'queued' ? 'Accept voice call' : 'Reconnect'}
                        </button>
                      ) : null}
                      {(ticket.status === 'queued' || ownedByMe) && (
                        <button
                          type="button"
                          className="btn-standard"
                          disabled={busy}
                          onClick={() => void close(ticket.id)}
                        >
                          Close ticket
                        </button>
                      )}
                    </div>
                  </div>

                  {ticket.transcript.length > 0 ? (
                    <details className="mt-4 rounded-ctl bg-surface px-3 py-2 text-12 text-t2">
                      <summary className="cursor-pointer font-semibold text-t1">
                        Conversation context ({ticket.transcript.length} messages)
                      </summary>
                      <ul className="mt-3 space-y-2 border-t border-line pt-3">
                        {ticket.transcript.slice(-8).map((line, index) => (
                          <li key={`${line.at}-${index}`} className="leading-relaxed">
                            <strong className="capitalize text-t1">{line.role}:</strong> {line.text}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <p className="mt-4 rounded-ctl bg-surface px-3 py-2 text-12 text-t3">
                      No transcript was captured. Start by asking the shopper to describe the issue.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
};

export default Queue;
