/* eslint-disable no-console */
// @ts-ignore
import { poll } from 'await-poll';
import { Subject } from 'rxjs';
import { Agent, InboundTransporter, OutboundTransporter } from '..';
import { toBeConnectedWith } from '../testUtils';
import { OutboundPackage, WireMessage } from '../types';
import indy from 'indy-sdk';

jest.setTimeout(10000);

expect.extend({ toBeConnectedWith });

const aliceConfig = {
  label: 'Alice',
  walletConfig: { id: 'alice' },
  walletCredentials: { key: '00000000000000000000000000000Test01' },
};

const bobConfig = {
  label: 'Bob',
  walletConfig: { id: 'bob' },
  walletCredentials: { key: '00000000000000000000000000000Test02' },
};

describe('agents', () => {
  let aliceAgent: Agent;
  let bobAgent: Agent;

  test('make a connection between agents', async () => {
    const aliceMessages = new Subject();
    const bobMessages = new Subject();

    const aliceAgentInbound = new SubjectInboundTransporter(aliceMessages);
    const aliceAgentOutbound = new SubjectOutboundTransporter(bobMessages);

    const bobAgentInbound = new SubjectInboundTransporter(bobMessages);
    const bobAgentOutbound = new SubjectOutboundTransporter(aliceMessages);

    aliceAgent = new Agent(aliceConfig, aliceAgentInbound, aliceAgentOutbound, indy);
    await aliceAgent.init();

    bobAgent = new Agent(bobConfig, bobAgentInbound, bobAgentOutbound, indy);
    await bobAgent.init();

    const aliceConnectionAtAliceBob = await aliceAgent.createConnection();
    const { invitation } = aliceConnectionAtAliceBob;

    if (!invitation) {
      throw new Error('There is no invitation in newly created connection!');
    }

    const bobConnectionAtBobAlice = await bobAgent.acceptInvitation(invitation);

    await aliceConnectionAtAliceBob.isConnected();
    console.log('aliceConnectionAtAliceBob\n', aliceConnectionAtAliceBob);

    if (!aliceConnectionAtAliceBob.theirKey) {
      throw new Error('Connection has not been initialized correctly!');
    }

    await bobConnectionAtBobAlice.isConnected();
    console.log('bobConnectionAtAliceBob\n', bobConnectionAtBobAlice);

    expect(aliceConnectionAtAliceBob).toBeConnectedWith(bobConnectionAtBobAlice);
    expect(bobConnectionAtBobAlice).toBeConnectedWith(aliceConnectionAtAliceBob);
  });

  test('send a message to connection', async () => {
    const aliceConnections = await aliceAgent.getConnections();
    console.log('aliceConnections', aliceConnections);

    const bobConnections = await bobAgent.getConnections();
    console.log('bobConnections', bobConnections);

    // send message from Alice to Bob
    const message = 'hello, world';
    await aliceAgent.sendMessageToConnection(aliceConnections[0], message);

    const bobMessages = await poll(
      async () => {
        console.log(`Getting Bob's messages from Alice...`);
        const messages = await bobAgent.basicMessageRepository.findByQuery({
          from: aliceConnections[0].did,
          to: aliceConnections[0].theirDid,
        });
        return messages;
      },
      (messages: WireMessage[]) => messages.length < 1
    );
    console.log(bobMessages);
    expect(bobMessages[0].content).toBe(message);
  });
});

class SubjectInboundTransporter implements InboundTransporter {
  subject: Subject<WireMessage>;

  constructor(subject: Subject<WireMessage>) {
    this.subject = subject;
  }

  start(agent: Agent) {
    this.subscribe(agent, this.subject);
  }

  subscribe(agent: Agent, subject: Subject<WireMessage>) {
    subject.subscribe({
      next: (message: WireMessage) => agent.receiveMessage(message),
    });
  }
}

class SubjectOutboundTransporter implements OutboundTransporter {
  subject: Subject<WireMessage>;

  constructor(subject: Subject<WireMessage>) {
    this.subject = subject;
  }

  async sendMessage(outboundPackage: OutboundPackage, receive_reply: boolean) {
    console.log('Sending message...');
    const { payload } = outboundPackage;
    console.log(payload);
    this.subject.next(payload);
  }
}
