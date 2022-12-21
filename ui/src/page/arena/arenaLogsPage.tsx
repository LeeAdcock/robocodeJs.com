import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

import Logs from './logs'
import User from './../../types/user'
import Arena from './../../types/arena'

let eventSource: EventSource | undefined

interface LogEntry {
    id: string
    name: string
    level: number
    levelName: string
    msg: string
    time: number
}

interface LogEntries {
    logs: (LogEntry | null)[]
    index: number
}

interface ArenaLogsPageProps {
    arena: Arena
}

export default function ArenaLogsPage(props: ArenaLogsPageProps) {
    const [logEntries, setLogEntries] = useState({
        logs: new Array(50) as LogEntry[],
        index: 0,
    } as LogEntries)
    const { userId } = useParams()

    useEffect(() => {
        if (eventSource) {
            eventSource.close()
            eventSource = undefined
        }
        eventSource = new EventSource(
            `https://port-3000-battletank-io-lee508578.preview.codeanywhere.com/api/user/${userId}/arena/logs`
        )

        eventSource.onmessage = (message) => {
            setLogEntries((oldLogs) => {
                const logEntry = JSON.parse(message.data) as LogEntry
                console.log('log', logEntry)
                oldLogs.logs[oldLogs.index] = logEntry
                return {
                    logs: oldLogs.logs,
                    index: (oldLogs.index + 1) % 50,
                }
            })
        }

        return () => {
            eventSource?.close()
        }
    }, [])

    return (
        <>
            <Logs logEntries={logEntries} selectedTankApp={''} />
        </>
    )
}
