/**
 * Field editors for pricing_plans.
 * ecommerce-products binds product scope (list | all); on program pages inherit is allowed.
 */

export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  ecommerce_products: "ecommerce-products",
};
