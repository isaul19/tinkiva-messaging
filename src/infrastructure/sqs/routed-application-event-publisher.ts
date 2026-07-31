import type { ApplicationEventPublisher } from "../../application/ports/application-event-publisher.js";
import type { RealtimeMessageEvent } from "../../contracts/api/realtime.contract.js";

export interface RoutedApplicationEventPublisherOptions {
  realtime: ApplicationEventPublisher;
  storagiaApplicationId: string;
  storagiaAutomation: ApplicationEventPublisher;
}

export class RoutedApplicationEventPublisher implements ApplicationEventPublisher {
  readonly #realtime: ApplicationEventPublisher;
  readonly #storagiaApplicationId: string;
  readonly #storagiaAutomation: ApplicationEventPublisher;

  public constructor(options: RoutedApplicationEventPublisherOptions) {
    this.#realtime = options.realtime;
    this.#storagiaApplicationId = options.storagiaApplicationId;
    this.#storagiaAutomation = options.storagiaAutomation;
  }

  public async publish(event: RealtimeMessageEvent): Promise<void> {
    const destinations: Promise<void>[] = [this.#realtime.publish(event)];

    if (
      event.applicationId === this.#storagiaApplicationId &&
      event.type === "message.received" &&
      event.data.message.direction === "INBOUND"
    ) {
      destinations.push(this.#storagiaAutomation.publish(event));
    }

    await Promise.all(destinations);
  }
}
