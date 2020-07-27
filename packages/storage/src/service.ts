/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { FirebaseApp } from '@firebase/app-types';
import * as args from './implementation/args';
import { Location } from './implementation/location';
import { FailRequest } from './implementation/failrequest';
import { Request, makeRequest } from './implementation/request';
import { RequestInfo } from './implementation/requestinfo';
import { XhrIoPool } from './implementation/xhriopool';
import { Reference, getParent, getChild } from './reference';
import { Provider } from '@firebase/component';
import { FirebaseAuthInternalName } from '@firebase/auth-interop-types';
import { FirebaseOptions } from '@firebase/app-types-exp';
import * as constants from '../src/implementation/constants';
import * as errorsExports from './implementation/error';

function isUrl(path?: string): boolean {
  return /^[A-Za-z]+:\/\//.test(path as string);
}

export function urlValidator(maybeUrl: unknown): void {
  if (typeof maybeUrl !== 'string') {
    throw 'Path is not a string.';
  }
  if (!isUrl) {
    throw 'Expected full URL but got a child path, use ref instead.';
  }
  try {
    Location.makeFromUrl(maybeUrl as string);
  } catch (e) {
    throw 'Expected valid full URL but got an invalid one.';
  }
}

export function pathValidator(path: unknown): void {
  if (typeof path !== 'string') {
    throw 'Path is not a string.';
  }
  if (isUrl(path)) {
    throw 'Expected child path but got a URL, use refFromURL instead.';
  }
}

export function serviceOrRefValidator(serviceOrRef: unknown): void {
  if (
    !(
      serviceOrRef instanceof StorageService ||
      serviceOrRef instanceof Reference
    )
  ) {
    throw 'Expected Storage instance or Reference.';
  }
}

export function serviceValidator(service: unknown): void {
  if (!(service instanceof StorageService)) {
    throw 'Expected Storage instance.';
  }
}

/**
 * Returns a firebaseStorage.Reference for the given url.
 */
function refFromURL(service: StorageService, url: string): Reference {
  args.validate(
    'refFromURL',
    [new args.ArgSpec(serviceValidator), args.stringSpec(urlValidator, false)],
    arguments
  );
  return new Reference(service, url);
}

/**
 * Returns a firebaseStorage.Reference for the given path in the default
 * bucket.
 */
function refFromPath(
  ref: StorageService | Reference,
  path?: string
): Reference | null {
  args.validate(
    'refFromPath',
    [
      new args.ArgSpec(serviceOrRefValidator),
      args.stringSpec(pathValidator, false)
    ],
    arguments
  );
  if (ref instanceof StorageService) {
    const service = ref;
    if (service.bucket_ == null) {
      throw new Error('No Storage Bucket defined in Firebase Options.');
    }
    const reference = new Reference(service, service.bucket_!);
    if (path != null) {
      return refFromPath(service, path);
    } else {
      return reference;
    }
  } else {
    // ref is a Reference
    if (path === '..') {
      return getParent(ref);
    } else if (typeof path === 'string') {
      return getChild(ref, path);
    } else {
      return ref;
    }
  }
}
/**
 * Returns a firebaseStorage.Reference for the given path in the default
 * bucket.
 */
/**
 * Returns a storage Reference for the given url, or given path in the
 * default bucket.
 * @param serviceOrRef `Storage` instance or storage `Reference`.
 * @param pathOrUrl Storage path, or URL. If empty, returns root reference (if Storage
 * instance provided) or returns same reference (if Reference provided).
 */
export function ref(
  serviceOrRef: StorageService | Reference,
  pathOrUrl?: string
): Reference | null {
  args.validate(
    'refFromURL',
    [
      new args.ArgSpec(serviceOrRefValidator),
      args.stringSpec(urlValidator, false)
    ],
    arguments
  );
  if (serviceOrRef instanceof StorageService && isUrl(pathOrUrl)) {
    return refFromURL(serviceOrRef, pathOrUrl!);
  } else if (pathOrUrl != null) {
    return refFromPath(serviceOrRef, pathOrUrl);
  } else {
    return null;
  }
}

/**
 * A service that provides Firebase Storage Reference instances.
 * @param opt_url gs:// url to a custom Storage Bucket
 *
 * @struct
 */
export class StorageService {
  app_: FirebaseApp | null;
  readonly bucket_: Location | null = null;
  private readonly authProvider_: Provider<FirebaseAuthInternalName>;
  private readonly appId_: string | null = null;
  private readonly pool_: XhrIoPool;
  private readonly requests_: Set<Request<unknown>>;
  deleted_: boolean = false;
  private maxOperationRetryTime_: number;
  private maxUploadRetryTime_: number;

  constructor(
    app: FirebaseApp | null,
    authProvider: Provider<FirebaseAuthInternalName>,
    pool: XhrIoPool,
    url?: string
  ) {
    this.app_ = app;
    this.authProvider_ = authProvider;
    this.maxOperationRetryTime_ = constants.DEFAULT_MAX_OPERATION_RETRY_TIME;
    this.maxUploadRetryTime_ = constants.DEFAULT_MAX_UPLOAD_RETRY_TIME;
    this.requests_ = new Set();
    this.pool_ = pool;
    if (url != null) {
      this.bucket_ = Location.makeFromBucketSpec(url);
    } else {
      this.bucket_ = StorageService.extractBucket_(this.app_?.options);
    }
  }

  private static extractBucket_(config?: FirebaseOptions): Location | null {
    const bucketString = config?.[constants.CONFIG_STORAGE_BUCKET_KEY];
    if (bucketString == null) {
      return null;
    }
    return Location.makeFromBucketSpec(bucketString);
  }

  async getAuthToken(): Promise<string | null> {
    const auth = this.authProvider_.getImmediate({ optional: true });
    if (auth) {
      const tokenData = await auth.getToken();
      if (tokenData !== null) {
        return tokenData.accessToken;
      }
    }
    return null;
  }

  /**
   * Stop running requests and prevent more from being created.
   */
  deleteApp(): void {
    this.deleted_ = true;
    this.app_ = null;
    this.requests_.forEach(request => request.cancel());
    this.requests_.clear();
  }

  /**
   * Returns a new firebaseStorage.Reference object referencing this StorageService
   * at the given Location.
   * @param loc The Location.
   * @return A firebaseStorage.Reference.
   */
  makeStorageReference(loc: Location): Reference {
    return new Reference(this, loc);
  }

  makeRequest<T>(
    requestInfo: RequestInfo<T>,
    authToken: string | null
  ): Request<T> {
    if (!this.deleted_) {
      const request = makeRequest(
        requestInfo,
        this.appId_,
        authToken,
        this.pool_
      );
      this.requests_.add(request);
      // Request removes itself from set when complete.
      request.getPromise().then(
        () => this.requests_.delete(request),
        () => this.requests_.delete(request)
      );
      return request;
    } else {
      return new FailRequest(errorsExports.appDeleted());
    }
  }

  get maxUploadRetryTime(): number {
    return this.maxUploadRetryTime_;
  }

  setMaxUploadRetryTime(time: number): void {
    args.validate(
      'setMaxUploadRetryTime',
      [args.nonNegativeNumberSpec()],
      arguments
    );
    this.maxUploadRetryTime_ = time;
  }

  get maxOperationRetryTime(): number {
    return this.maxOperationRetryTime_;
  }

  setMaxOperationRetryTime(time: number): void {
    args.validate(
      'setMaxOperationRetryTime',
      [args.nonNegativeNumberSpec()],
      arguments
    );
    this.maxOperationRetryTime_ = time;
  }

  get app(): FirebaseApp | null {
    return this.app_;
  }
}
