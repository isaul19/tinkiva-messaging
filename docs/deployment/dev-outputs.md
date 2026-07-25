# Development environment outputs

Deployment date: 2026-07-25  
AWS account: `160358212333`  
Region: `us-east-1`  
Stack: `tinkiva-messaging-gateway-dev`

## HTTP API

```text
Base URL: https://2myga1gnfl.execute-api.us-east-1.amazonaws.com
Health:   https://2myga1gnfl.execute-api.us-east-1.amazonaws.com/health
```

## Data

```text
Control table: messaging-control-dev
Message table: messaging-data-dev
Media bucket:  tinkiva-messaging-media-dev-160358212333
```

## Queues

```text
Inbound:          messaging-inbound-events-dev.fifo
WhatsApp outbound: messaging-outbound-whatsapp-dev.fifo
Telegram outbound: messaging-outbound-telegram-dev.fifo
Application events: messaging-app-events-dev.fifo
Media:             messaging-media-dev
```

Every source queue has a corresponding `-dlq-` queue with a 14-day retention period.

## Operations

```text
Alarm topic: arn:aws:sns:us-east-1:160358212333:tinkiva-messaging-alarms-dev
Alarm subscription: none
```

Secret names:

```text
/tinkiva/messaging/dev/auth/pepper
/tinkiva/messaging/dev/auth/jwt-signing
```

Do not add secret values to this file.
