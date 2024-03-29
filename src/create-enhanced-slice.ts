import {
  PayloadAction,
  SliceCaseReducers,
  ValidateSliceCaseReducers,
  createSlice,
  isAnyOf,
} from '@reduxjs/toolkit';
import { getUnique, isUnique, sliceSelectorString, sliceString } from './utils';
import {
  BaseQueryFn,
  EndpointDefinitions,
  QueryDefinition,
} from '@reduxjs/toolkit/dist/query';
import type { ActionReducerMapBuilder } from '@reduxjs/toolkit';
import type {
  SliceEnum,
  SliceState,
  ObjectKeys,
  SliceSelector,
  InitialStateSlice,
  SliceConsolidateReducers,
  RootState,
  NoInfer,
  IgnoreDefaultReducers,
  ConstructSliceCases,
} from './types';
import { ApiEndpointQuery } from '@reduxjs/toolkit/dist/query/core/module';

/**
 * Retrieves the key of an enum object based on its value.
 * @param {T} enumObject - Enum object of type `T` containing key-value pairs.
 * @param {string} value - The value of an enum member to find the corresponding key.
 * @returns The key of the enum object that matches the provided value, or `undefined` if not found.
 */
const getKeyFromEnumValue = <T extends object>(
  enumObject: T,
  value: string
) => {
  return Object.entries(enumObject).find(([_, v]) => v === value)?.[0];
};

/**
 * Creates an enum-like object with modified keys based on an initial key and a name.
 * @param {T} obj - Generic object of type `T` to create an enum from.
 * @param {K} initialKey - The starting key for the enumeration, of type `K`.
 * @param {S} name - String used as a prefix to create modified keys for the enum, of type `S`.
 * @returns An object of type `SliceEnum<K, S>` that maps keys of type `K` to their corresponding
 * modified keys of type `S`.
 */
const createEnumObject = <T, K, S extends string>(
  obj: T,
  initialKey: K,
  name: S
): SliceEnum<K, S> => {
  const createModifiedKeys = (key: string) => ({
    [sliceString(name, key)]: key,
  });

  const processKeys = (accumulator: Record<string, unknown>, key: string) => {
    const modifiedKey = modifiedKeys.find((record) => record[key])?.[key];
    accumulator[key] = modifiedKey;
    accumulator[modifiedKey] = key;
    return accumulator;
  };

  const modifiedKeys = Object.keys(initialKey).map(createModifiedKeys);
  const result = Object.keys(obj).reduce(processKeys, Object.create(null));

  return Object.freeze(result);
};

/**
 * Modifies an initial state object by creating a new object with additional properties
 * based on the keys of the original object.
 * @param {T} state - Initial state of type `T` to be modified.
 * @param {S} name - Name of the slice to be created from the initial state, of type `S`.
 * @returns An object with properties containing keys generated by concatenating the `name` argument
 * with each key in the `state` object. The value of each property is an object with the following
 * properties: `results`, `isLoading`, `hasMore`, `page`, and `errors`.
 */
const createInitialStateSlice = <
  T extends Z extends true ? never : unknown,
  S extends string,
  Z extends boolean | Array<keyof T>
>(
  state: T,
  name: S,
  ignoreDefaultReducers?: Z
): InitialStateSlice<T, S, Z> => {
  const createSliceState = (
    accumulator: Record<string, unknown>,
    key: string
  ) => {
    if (
      ignoreDefaultReducers ||
      ['number', 'string', 'boolean'].includes(typeof state[key])
    ) {
      accumulator[sliceString(name, key)] = state[key];
    } else {
      accumulator[sliceString(name, key)] = {
        results: state[key],
        isLoading: false,
        hasMore: true,
        page: 0,
        errors: null,
      };
    }

    return accumulator;
  };

  return Object.keys(state).reduce(createSliceState, Object.create(null));
};

/**
 * Creates a Redux slice with standardized cases for handling asynchronous actions and
 * generates selectors for accessing the slice state.
 * @param {S} name - Name of the slice, used to identify it in the Redux store.
 * @param {T} initialState - Initial state of the slice.
 * @returns An object containing the created slice, `queryTypes`, and `selectors`.
 * `queryTypes` maps the initial state keys to string values, and `selectors` contains
 * selector functions for each key in the `queryTypes` object.
 *
 * @example
 * const { slice, queryTypes, selectors } = sliceCreator('users', {
 *  users: [],
 *  user: null,
 * }, {
 *  cases: {
 *    pending: ['fetchUsers', 'fetchUser'],
 *  }
 * });
 *
 * const { fetchUsers, fetchUser } = slice.actions;
 * const { selectUsersUsers, selectUsersUser } = selectors;
 * const { users, user } = queryTypes;
 */
export const sliceCreator = <
  S extends string,
  T extends Z['ignoreDefaultReducers'] extends true | keyof T ? any : unknown,
  Y extends {
    reducers?: ValidateSliceCaseReducers<
      InitialStateSlice<T, S, Z>,
      SliceCaseReducers<InitialStateSlice<T, S, Z>>
    >;
    extraReducers?: (
      builder: ActionReducerMapBuilder<
        NoInfer<InitialStateSlice<T, S, Z & never>>
      >
    ) => void;
    cases?: {
      pending?: ApiEndpointQuery<
        QueryDefinition<unknown, BaseQueryFn, string, unknown>,
        EndpointDefinitions
      >[];
      fulfilled?: ApiEndpointQuery<
        QueryDefinition<unknown, BaseQueryFn, string, unknown>,
        EndpointDefinitions
      >[];
      rejected?: ApiEndpointQuery<
        QueryDefinition<unknown, BaseQueryFn, string, unknown>,
        EndpointDefinitions
      >[];
      all?: ApiEndpointQuery<
        QueryDefinition<unknown, BaseQueryFn, string, unknown>,
        EndpointDefinitions
      >[];
    };
  },
  Z extends {
    debug?: boolean;
    HYDRATE?: string;
    ignoreDefaultReducers?: Array<keyof T> | boolean;
    shouldUseHydrate?: boolean;
  }
>(
  name: S,
  initialState: T,
  sliceOptions?: Y,
  options?: Z
) => {
  const debugMessages = {
    INVALID_KEY: `Invalid key or no key provided. The key must be one of the following:`,
    SLICE_CREATED: `created slices for ${name}:`,
    SELECTOR_CREATED: `composed selectors for ${name}:`,
    IGNORED_DEFAULT_REDUCERS: `You are trying to access internal method setPageData while ignoreDefaultReducers is true`,
    IGNORED_DEFAULT_REDUCERS_WARN: `When ignoreDefaultReducers is true, you must provide your own reducers to be updated`,
  };

  const {
    reducers = {},
    extraReducers,
    cases: { pending = [], fulfilled = [], rejected = [], all = [] } = {},
  } = sliceOptions;

  const {
    debug,
    ignoreDefaultReducers,
    shouldUseHydrate = true,
    HYDRATE = 'HYDRATE',
  } = options || {};

  const getInitialStateSlice = createInitialStateSlice(
    initialState,
    name,
    ignoreDefaultReducers
  );
  type QueryKey = typeof getInitialStateSlice & string;

  type ActionBuilder = ActionReducerMapBuilder<
    NoInfer<InitialStateSlice<T, S, Z & never>>
  >;
  type ComposeSelectorsReturnType = {
    [K in ObjectKeys<typeof queryTypeEnums> as SliceSelector<K, S>]: (
      state: RootState
    ) => IgnoreDefaultReducers<SliceState<T[K]>, T[K], Z>;
  };

  const createDebuggingMessage = (
    message,
    type: 'log' | 'error' | 'warn' = 'log'
  ) => {
    if (debug) {
      console[type](`🌜 [sliceCreator]: ${message[0]} 🌛`, ...message.slice(1));
    }
  };

  const queryTypeEnums = createEnumObject(
    getInitialStateSlice,
    initialState,
    name
  );

  if (ignoreDefaultReducers)
    createDebuggingMessage([debugMessages.IGNORED_DEFAULT_REDUCERS], 'warn');
  createDebuggingMessage([debugMessages.SLICE_CREATED, getInitialStateSlice]);

  /**
   * This function concatenates results from a paginated API request to
   * the current state if the page number is greater than 1 and the data object contains an array of results.
   * If the data object is null or undefined, the original state is returned.
   * @param {Object} state  - The current state of the slice.
   * @param {Object} data - The data object returned from the API request.
   */
  const bundleCase = (state: SliceState<T>, data) => {
    const cannnotConcat = data?.page === 1 || !data.page;
    const isArray = Array.isArray(data?.results);
    const canConcatForPagingToken =
      typeof state.page === 'string' && data.page === state.page;

    state.results =
      cannnotConcat || !isArray
        ? data?.results
        : [
            ...(state.results as T[]),
            ...(canConcatForPagingToken ? [] : (data.results as T[])),
          ];

    state.hasMore = isArray ? (data?.results as T[]).length > 0 : true;
  };

  const composeSelectors = (): ComposeSelectorsReturnType => {
    const createSelector = (
      accumulator: Record<string, unknown>,
      key: string
    ) => {
      const selectorName = sliceSelectorString(name, key);

      accumulator[selectorName] = (state: RootState) => {
        return state[name][getKeyFromEnumValue(queryTypeEnums, key)];
      };

      return accumulator;
    };

    /* If the `debug` property in the `options` object is truthy,
     * logs a message to the console with information about the composed
     * selector for the slice, including the slice name and the result
     * of calling the `createSelector` function on each key in the
     * `initialState` object. Useful for debugging and development.
     */

    const composedSelectors = Object.keys(initialState).reduce(
      createSelector,
      {}
    );

    createDebuggingMessage([debugMessages.SELECTOR_CREATED, composedSelectors]);

    return Object.freeze(composedSelectors) as ComposeSelectorsReturnType;
  };

  const constructPendingCases = (builder: ActionBuilder, cases: unknown[]) => {
    return builder.addMatcher(
      isAnyOf(...cases.map((c: ConstructSliceCases) => c.matchPending)),
      (state, action) => {
        const key = action.meta.arg.originalArgs._queryType;
        const newState = state[key as QueryKey];

        if (key && getKeyFromEnumValue(queryTypeEnums, key)) {
          newState.isLoading = true;
        } else {
          createDebuggingMessage(
            [debugMessages.INVALID_KEY, Object.keys(initialState).join(', ')],
            'error'
          );
        }
      }
    );
  };

  const constructFailedCases = (builder: ActionBuilder, cases: unknown[]) => {
    return builder.addMatcher(
      isAnyOf(...cases.map((c: ConstructSliceCases) => c.matchRejected)),
      (state, action) => {
        const key = action.meta.arg.originalArgs._queryType;
        const newState = state[key as QueryKey];
        if (key && getKeyFromEnumValue(queryTypeEnums, key)) {
          if (newState?.isLoading) newState.isLoading = false;
          if (newState?.errors) newState.errors = action.payload;
        } else {
          createDebuggingMessage(
            [debugMessages.INVALID_KEY, Object.keys(initialState).join(', ')],
            'error'
          );
        }
      }
    );
  };

  const constructSuccessCases = (builder: ActionBuilder, cases: unknown[]) => {
    return builder.addMatcher(
      isAnyOf(...cases.map((c: ConstructSliceCases) => c.matchFulfilled)),
      (state, action) => {
        const key = action.meta.arg.originalArgs._queryType;
        const newState = state[key as QueryKey];

        if (key && getKeyFromEnumValue(queryTypeEnums, key)) {
          if (action?.payload?.results || action?.payload?.results?.length) {
            if (Array.isArray(newState.results) && newState?.results?.length) {
              /**
               * Right here we are smartly checking if the results are unique or not.
               * If they are not unique, we don't add them to the state.
               * This is useful for when you are using the `useInfiniteQuery` hook
               */
              const itemIsUnique =
                isUnique([
                  ...newState.results,
                  ...(action?.payload?.results ?? []),
                ]) &&
                isUnique([...newState.results]) &&
                !newState.hasMore;

              if (itemIsUnique) {
                newState.results = getUnique([
                  ...newState.results,
                  ...(action?.payload?.results ?? []),
                ]);
              }
            } else if (!newState?.results?.length || newState.page === 1) {
              newState.results = action?.payload?.results;
            }
          }

          newState.isLoading = false;
        } else {
          createDebuggingMessage(
            [debugMessages.INVALID_KEY, Object.keys(initialState).join(', ')],
            'error'
          );
        }
      }
    );
  };

  const slice = createSlice({
    name,
    initialState: createInitialStateSlice(initialState, name),
    reducers: {
      ...reducers,
      /**
       * @private
       * @param {Object} state - The current state of the slice.
       * @param {Object} action - The action dispatched to the reducer.
       */
      setPageData(
        state,
        action: PayloadAction<{
          _queryType?: keyof typeof getInitialStateSlice;
          data: SliceState<T> & {
            _queryType?: keyof typeof getInitialStateSlice;
          };
        }>
      ) {
        if (ignoreDefaultReducers) {
          createDebuggingMessage(
            [debugMessages.IGNORED_DEFAULT_REDUCERS],
            'warn'
          );
          return;
        } else {
          const { _queryType: type, data } = action.payload;
          const consolidateQueryType = type || data._queryType;

          if (!consolidateQueryType) {
            createDebuggingMessage(
              [debugMessages.INVALID_KEY, Object.keys(initialState).join(', ')],
              'error'
            );
          }

          const newState = state[consolidateQueryType as QueryKey];
          if (data.errors) newState.errors = data.errors;
          if (data.page) newState.page = data.page;

          bundleCase(newState, data);

          newState.isLoading = data?.isLoading || false;
        }
      },
    },
    extraReducers: (builder) => {
      shouldUseHydrate &&
        builder.addCase(HYDRATE, (state: RootState, action: unknown) => {
          return {
            ...state,
            ...(
              action as {
                payload: RootState;
              }
            ).payload[name],
          };
        });

      extraReducers?.(builder);

      if (!ignoreDefaultReducers) {
        if (all.length) {
          constructPendingCases(builder, all);
          constructSuccessCases(builder, all);
          constructFailedCases(builder, all);
        } else {
          !!pending.length && constructPendingCases(builder, pending);
          !!fulfilled.length && constructSuccessCases(builder, fulfilled);
          !!rejected.length && constructFailedCases(builder, rejected);
        }
      }
    },
  });

  return {
    ...slice,
    queryTypes: queryTypeEnums,
    actions: {
      ...(slice.actions as unknown as typeof slice.actions &
        SliceConsolidateReducers<Y['reducers'], S>),
    },
    selectors: composeSelectors(),
  };
};
