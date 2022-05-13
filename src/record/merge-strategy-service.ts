import { Services } from "../deepstream-client.ts";
import { EVENT, RecordData, TOPIC } from "../constants.ts";

import { MergeStrategy } from "./merge-strategy.ts";
import { JSONObject } from "../../types/all.ts";
import { RecordMessage } from "../../types/messages.ts";

export type MergeCompleteInternal = (
  error: string | null,
  message: RecordMessage,
  mergedData: RecordData,
  localVersion: number,
  localData: RecordData,
) => void;
export class MergeStrategyService {
  private services: Services;
  private strategiesByRecord: Map<string, MergeStrategy>;
  private strategiesByPattern: Map<RegExp, MergeStrategy>;
  private defaultStrategy: MergeStrategy | null;

  constructor(services: Services, defaultStrategy: MergeStrategy | null) {
    this.services = services;
    this.defaultStrategy = defaultStrategy;
    this.strategiesByRecord = new Map();
    this.strategiesByPattern = new Map();
  }

  setMergeStrategyByName(recordName: string, strategy: MergeStrategy) {
    this.strategiesByRecord.set(recordName, strategy);
  }

  setMergeStrategyByPattern(pattern: RegExp, strategy: MergeStrategy) {
    this.strategiesByPattern.set(pattern, strategy);
  }

  merge(
    remoteRecord: RecordMessage,
    localVersion: number,
    localData: RecordData,
    callback: MergeCompleteInternal,
    // deno-lint-ignore no-explicit-any
    context: any,
  ): void {
    const { name: recordName } = remoteRecord;

    const exactMergeStrategy = this.strategiesByRecord.get(recordName);
    if (exactMergeStrategy) {
      exactMergeStrategy(
        localData,
        localVersion,
        remoteRecord.parsedData as JSONObject,
        remoteRecord.version!,
        (error, data) => {
          callback.call(
            context,
            error,
            remoteRecord,
            data,
            localVersion,
            localData,
          );
        },
      );
      return;
    }

    for (const [pattern, patternMergeStrategy] of this.strategiesByPattern) {
      if (pattern.test(recordName)) {
        patternMergeStrategy(
          localData,
          localVersion,
          remoteRecord.parsedData as JSONObject,
          remoteRecord.version!,
          (error, data) => {
            callback.call(
              context,
              error,
              remoteRecord,
              data,
              localVersion,
              localData,
            );
          },
        );
        return;
      }
    }

    if (this.defaultStrategy) {
      this.defaultStrategy(
        localData,
        localVersion,
        remoteRecord.parsedData as JSONObject,
        remoteRecord.version!,
        (error, data) => {
          callback.call(
            context,
            error,
            remoteRecord,
            data,
            localVersion,
            localData,
          );
        },
      );
      return;
    }

    this.services.logger.error(
      { topic: TOPIC.RECORD },
      EVENT.RECORD_VERSION_EXISTS,
      { remoteVersion: remoteRecord.version!, recordName },
    );
  }
}
