import { configureStore } from "@reduxjs/toolkit";
import { chatReducer } from "./chat-slice";
export const makeStore = () =>
  configureStore({ reducer: { chat: chatReducer } });
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
