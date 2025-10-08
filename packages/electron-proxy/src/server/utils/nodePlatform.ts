/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as util from 'util';
import { Readable, Writable, pipeline } from 'stream';
import { EventEmitter } from 'events';

import { colors } from '../../utilsBundle';
import { debugLogger } from './debugLogger';
import { currentZone, emptyZone } from './zones';
import { debugMode, isUnderTest } from './debug';

import type { Zone as ZoneImpl } from './zones';
import type * as channels from '@protocol/channels';

const pipelineAsync = util.promisify(pipeline);

let boxedStackPrefixes: string[] = [];
export function setBoxedStackPrefixes(prefixes: string[]) {
  boxedStackPrefixes = prefixes;
}

const coreDir = path.dirname(require.resolve('../../../package.json'));

class ReadableStreamImpl extends Readable {
  private _channel: channels.StreamChannel;

  constructor(channel: channels.StreamChannel) {
    super();
    this._channel = channel;
  }

  override async _read() {
    const result = await this._channel.read({ size: 1024 * 1024 });
    if (result.binary.byteLength)
      this.push(result.binary);
    else
      this.push(null);
  }

  override _destroy(error: Error | null, callback: (error: Error | null | undefined) => void): void {
    // Stream might be destroyed after the connection was closed.
    this._channel.close().catch(e => null);
    super._destroy(error, callback);
  }
}

class WritableStreamImpl extends Writable {
  private _channel: channels.WritableStreamChannel;

  constructor(channel: channels.WritableStreamChannel) {
    super();
    this._channel = channel;
  }

  override async _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    const error = await this._channel.write({ binary: typeof chunk === 'string' ? Buffer.from(chunk) : chunk }).catch(e => e);
    callback(error || null);
  }

  override async _final(callback: (error?: Error | null) => void) {
    // Stream might be destroyed after the connection was closed.
    const error = await this._channel.close().catch(e => e);
    callback(error || null);
  }
}
